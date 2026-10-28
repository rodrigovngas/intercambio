-- Guest access is scoped to an individual invitation and a server-verified NIP.
-- This adds no auth.users and changes no Stocka authentication settings.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table intercambio_private.pin_credentials (
  participant_id uuid primary key references public.intercambio_participants(id) on delete cascade,
  pin_hash text not null check (pin_hash like '$2a$10$%' and length(pin_hash)=60),
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table intercambio_private.guest_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  participant_id uuid not null references intercambio_private.pin_credentials(participant_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index intercambio_guest_sessions_participant_idx on intercambio_private.guest_sessions(participant_id);
create index intercambio_guest_sessions_expiry_idx on intercambio_private.guest_sessions(expires_at);
alter table intercambio_private.pin_credentials enable row level security;
alter table intercambio_private.guest_sessions enable row level security;
revoke all on intercambio_private.pin_credentials,intercambio_private.guest_sessions from public,anon,authenticated;
grant all on intercambio_private.pin_credentials,intercambio_private.guest_sessions to service_role;

-- The allowlist is server-owned and tied to both the existing account UUID and
-- its verified email, never editable user_metadata or a client-side email check.
create table intercambio_private.organizer_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_hash text not null check (email_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table intercambio_private.organizer_access enable row level security;
revoke all on intercambio_private.organizer_access from public,anon,authenticated;
grant all on intercambio_private.organizer_access to service_role;
insert into intercambio_private.organizer_access(user_id,email_hash)
select u.id,encode(extensions.digest(lower(u.email),'sha256'),'hex') from auth.users u
where u.id='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'::uuid
  and u.email is not null and u.email_confirmed_at is not null;

create function intercambio_private.is_organizer() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid()='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'::uuid and exists(
    select 1 from auth.users u join intercambio_private.organizer_access a on a.user_id=u.id where u.id=auth.uid()
      and a.email_hash=encode(extensions.digest(lower(u.email),'sha256'),'hex') and u.email_confirmed_at is not null
  );
$$;
create function intercambio_private.require_organizer() returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if not coalesce(intercambio_private.is_organizer(),false) then
    raise exception 'Solo el organizador autorizado puede administrar eventos.' using errcode='42501';
  end if;
  -- Hold shared access through the administration transaction. Account removal
  -- takes an exclusive lock so an in-flight event cannot be created afterwards.
  perform 1 from intercambio_private.organizer_access where user_id=auth.uid() for share;
  if not found then
    raise exception 'El acceso de organizador ya no está disponible.' using errcode='42501';
  end if;
  return auth.uid();
end;
$$;
create function public.intercambio_is_organizer() returns boolean
language sql stable security invoker set search_path='' as $$ select coalesce(intercambio_private.is_organizer(),false); $$;

-- Preserve the existing implementation and ownership rules while adding the
-- organizer guard to every administration entry point (including legacy claim).
do $$
declare v_function record; v_definition text;
begin
  for v_function in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='intercambio_private' and p.proname in
      ('create_event','update_event','add_participant','remove_participant','draw_event','archive_event','claim_participant')
  loop
    v_definition:=pg_get_functiondef(v_function.oid);
    if strpos(v_definition,'intercambio_private.require_user()')=0 then
      raise exception 'No se encontró el control de identidad esperado para %.',v_function.oid::regprocedure;
    end if;
    execute replace(v_definition,'intercambio_private.require_user()','intercambio_private.require_organizer()');
  end loop;
end;
$$;

create or replace function intercambio_private.get_participant_invites(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_result jsonb;
begin
  if not exists(select 1 from public.intercambio_events where id=p_event_id and owner_id=v_user) then
    raise exception 'No tienes acceso a las invitaciones.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'participant_id',p.id,'name',p.name,'token',i.token,
    'claimed',c.participant_id is not null,'has_pin',c.participant_id is not null,
    'account_linked',p.user_id is not null,'revealed',a.revealed_at is not null
  ) order by p.created_at,p.name),'[]'::jsonb) into v_result
  from public.intercambio_participants p
  join intercambio_private.participant_invites i on i.participant_id=p.id
  left join intercambio_private.pin_credentials c on c.participant_id=p.id
  left join intercambio_private.assignments a on a.event_id=p.event_id and a.giver_id=p.id
  where p.event_id=p_event_id and not p.is_child;
  return v_result;
end;
$$;
create or replace function public.intercambio_get_participant_invites(p_event_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.get_participant_invites(p_event_id); $$;

create function intercambio_private.guest_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then
    raise exception 'La invitación no es válida.' using errcode='22023';
  end if;
  select jsonb_build_object('event_id',e.id,'title',e.title,'event_date',e.event_date,
    'budget',e.budget,'gift_type',e.gift_type,'status',e.status,'drawn_at',e.drawn_at,
    'participant_id',p.id,'participant_name',p.name,'has_pin',c.participant_id is not null)
  into v_result
  from intercambio_private.participant_invites i
  join public.intercambio_participants p on p.id=i.participant_id and p.event_id=i.event_id
  join public.intercambio_events e on e.id=p.event_id
  left join intercambio_private.pin_credentials c on c.participant_id=p.id
  where i.token=p_token and not p.is_child and e.status<>'archived';
  if v_result is null then
    raise exception 'La invitación no existe o el evento está archivado.' using errcode='22023';
  end if;
  return v_result;
end;
$$;

-- Internal bearer-session issuer. EXECUTE is never granted to browser roles.
create function intercambio_private.issue_guest_session(p_participant_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); v_expires timestamptz:=clock_timestamp()+interval '12 hours';
begin
  delete from intercambio_private.guest_sessions where participant_id=p_participant_id and expires_at<=clock_timestamp();
  insert into intercambio_private.guest_sessions(token_hash,participant_id,expires_at)
  values(encode(extensions.digest(v_token,'sha256'),'hex'),p_participant_id,v_expires);
  return jsonb_build_object('ok',true,'session_token',v_token,'expires_at',v_expires);
end;
$$;

create function intercambio_private.guest_register(p_token text,p_pin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_participant uuid;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'error','La invitación no es válida.'); end if;
  if p_pin is null or p_pin!~'^[0-9]{6}$' then return jsonb_build_object('ok',false,'error','El NIP debe tener exactamente seis números.'); end if;
  select i.event_id into v_event from intercambio_private.participant_invites i where i.token=p_token;
  -- All guest mutation paths lock event -> invitation -> credential/session.
  -- This serializes registration/reset/removal without weakening RLS.
  perform 1 from public.intercambio_events where id=v_event and status<>'archived' for share;
  if not found then return jsonb_build_object('ok',false,'error','La invitación no existe o el evento está archivado.'); end if;
  select p.id into v_participant from intercambio_private.participant_invites i
    join public.intercambio_participants p on p.id=i.participant_id and p.event_id=i.event_id
    where i.token=p_token and not p.is_child for update of i;
  if v_participant is null then return jsonb_build_object('ok',false,'error','La invitación no es válida.'); end if;
  if exists(select 1 from intercambio_private.pin_credentials where participant_id=v_participant) then
    return jsonb_build_object('ok',false,'error','Este perfil ya tiene un NIP. Ingresa con él.');
  end if;
  insert into intercambio_private.pin_credentials(participant_id,pin_hash)
    values(v_participant,extensions.crypt(p_pin,extensions.gen_salt('bf',10)));
  return intercambio_private.issue_guest_session(v_participant);
end;
$$;

create function intercambio_private.guest_login(p_token text,p_pin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_participant uuid; v_credentials intercambio_private.pin_credentials; v_attempts integer; v_now timestamptz:=clock_timestamp();
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'error','La invitación no es válida.'); end if;
  if p_pin is null or p_pin!~'^[0-9]{6}$' then return jsonb_build_object('ok',false,'error','El NIP debe tener exactamente seis números.'); end if;
  select event_id into v_event from intercambio_private.participant_invites where token=p_token;
  perform 1 from public.intercambio_events where id=v_event and status<>'archived' for share;
  if not found then return jsonb_build_object('ok',false,'error','La invitación no existe o el evento está archivado.'); end if;
  select p.id into v_participant from intercambio_private.participant_invites i
    join public.intercambio_participants p on p.id=i.participant_id and p.event_id=i.event_id
    where i.token=p_token and not p.is_child for update of i;
  if v_participant is null then return jsonb_build_object('ok',false,'error','La invitación no es válida.'); end if;
  select * into v_credentials from intercambio_private.pin_credentials where participant_id=v_participant for update;
  if not found then return jsonb_build_object('ok',false,'error','Primero crea tu NIP para este intercambio.'); end if;
  v_now:=clock_timestamp();
  if v_credentials.locked_until>v_now then
    return jsonb_build_object('ok',false,'error','Demasiados intentos. Espera antes de volver a ingresar.',
      'retry_after_seconds',ceil(extract(epoch from v_credentials.locked_until-v_now))::integer);
  end if;
  if v_credentials.locked_until is not null then
    v_credentials.failed_attempts:=0;
  end if;
  if extensions.crypt(p_pin,v_credentials.pin_hash)<>v_credentials.pin_hash then
    v_attempts:=v_credentials.failed_attempts+1;
    update intercambio_private.pin_credentials set failed_attempts=v_attempts,
      locked_until=case when v_attempts>=5 then v_now+interval '15 minutes' else null end
    where participant_id=v_participant;
    -- Do not RAISE: returning an error value commits the failed-attempt counter.
    return jsonb_build_object('ok',false,'error',case when v_attempts>=5
      then 'Demasiados intentos. Espera 15 minutos antes de volver a ingresar.' else 'El NIP no es correcto.' end,
      'retry_after_seconds',case when v_attempts>=5 then 900 else 0 end);
  end if;
  update intercambio_private.pin_credentials set failed_attempts=0,locked_until=null where participant_id=v_participant;
  return intercambio_private.issue_guest_session(v_participant);
end;
$$;

create function intercambio_private.guest_context(p_session_token text)
returns table(participant_id uuid,event_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_hash text; v_event uuid;
begin
  if p_session_token is null or p_session_token!~'^[a-f0-9]{64}$' then
    raise exception 'Tu sesión de invitado terminó. Abre tu invitación e ingresa tu NIP de nuevo.' using errcode='28000';
  end if;
  v_hash:=encode(extensions.digest(p_session_token,'sha256'),'hex');
  select p.event_id into v_event from intercambio_private.guest_sessions s
    join public.intercambio_participants p on p.id=s.participant_id where s.token_hash=v_hash;
  perform 1 from public.intercambio_events e where e.id=v_event and e.status<>'archived' for share;
  if found then
    return query select s.participant_id,p.event_id,s.expires_at from intercambio_private.guest_sessions s
      join public.intercambio_participants p on p.id=s.participant_id
      where s.token_hash=v_hash and s.expires_at>clock_timestamp() and not p.is_child for share of s;
    if found then return; end if;
  end if;
  raise exception 'Tu sesión de invitado terminó. Abre tu invitación e ingresa tu NIP de nuevo.' using errcode='28000';
end;
$$;

create function intercambio_private.guest_profile(p_session_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_context record; v_result jsonb;
begin
  select * into strict v_context from intercambio_private.guest_context(p_session_token);
  select jsonb_build_object('participant_id',v_context.participant_id,'expires_at',v_context.expires_at,
    'event',jsonb_build_object('id',e.id,'title',e.title,'event_date',e.event_date,'budget',e.budget,
      'gift_type',e.gift_type,'status',e.status,'drawn_at',e.drawn_at),
    'profiles',(select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_child',p.is_child,'wishes',p.wishes,'extra',p.extra)
      order by p.is_child,p.created_at,p.name) from public.intercambio_participants p
      where p.event_id=e.id and (p.id=v_context.participant_id or p.guardian_id=v_context.participant_id)))
  into v_result from public.intercambio_events e where e.id=v_context.event_id;
  return v_result;
end;
$$;

create function intercambio_private.guest_assignment(p_session_token text,p_participant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_context record; v_result jsonb;
begin
  select * into strict v_context from intercambio_private.guest_context(p_session_token);
  if not exists(select 1 from public.intercambio_participants p where p.id=p_participant_id and p.event_id=v_context.event_id
    and (p.id=v_context.participant_id or p.guardian_id=v_context.participant_id)) then
    raise exception 'Este resultado es privado.' using errcode='42501';
  end if;
  select jsonb_build_object('participant_id',p_participant_id,'target_id',p.id,'target_name',p.name,'wishes',p.wishes,'extra',p.extra)
  into v_result from intercambio_private.assignments a join public.intercambio_participants p on p.id=a.receiver_id and p.event_id=a.event_id
  where a.event_id=v_context.event_id and a.giver_id=p_participant_id;
  if v_result is null then raise exception 'El sorteo todavía no se ha realizado.'; end if;
  update intercambio_private.assignments set revealed_at=coalesce(revealed_at,clock_timestamp())
    where event_id=v_context.event_id and giver_id=p_participant_id;
  return v_result;
end;
$$;

create function intercambio_private.guest_save_wishes(p_session_token text,p_participant_id uuid,p_wishes text[],p_extra text default '') returns void
language plpgsql security definer set search_path='' as $$
declare v_context record;
begin
  select * into strict v_context from intercambio_private.guest_context(p_session_token);
  if not exists(select 1 from public.intercambio_participants p where p.id=p_participant_id and p.event_id=v_context.event_id
    and (p.id=v_context.participant_id or p.guardian_id=v_context.participant_id)) then
    raise exception 'Solo puedes editar tu perfil o tus dependientes.' using errcode='42501';
  end if;
  update public.intercambio_participants set wishes=p_wishes,extra=coalesce(p_extra,'') where id=p_participant_id;
end;
$$;

create function intercambio_private.guest_logout(p_session_token text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_session_token is null or p_session_token!~'^[a-f0-9]{64}$' then return; end if;
  delete from intercambio_private.guest_sessions where token_hash=encode(extensions.digest(p_session_token,'sha256'),'hex');
end;
$$;

create function intercambio_private.reset_pin(p_participant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_event uuid;
begin
  select event_id into v_event from public.intercambio_participants where id=p_participant_id and not is_child;
  perform 1 from public.intercambio_events where id=v_event and owner_id=v_user for update;
  if not found then raise exception 'No tienes acceso a este participante.' using errcode='42501'; end if;
  -- The FK cascade invalidates all of this guest's sessions, preserving wishes,
  -- dependent relationships and the draw. The existing invitation remains valid.
  delete from intercambio_private.pin_credentials where participant_id=p_participant_id;
end;
$$;

create function intercambio_private.delete_event(p_event_id uuid,p_confirmation text) returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer();
begin
  if p_confirmation is distinct from 'ELIMINAR' then
    raise exception 'Escribe ELIMINAR para confirmar la eliminación del evento.' using errcode='22023';
  end if;
  perform 1 from public.intercambio_events where id=p_event_id and owner_id=v_user for update;
  if not found then raise exception 'No tienes acceso a este evento.' using errcode='42501'; end if;
  -- Existing foreign keys cascade participants, wishes, invitations, assignments,
  -- PIN credentials and sessions. No records from another event are affected.
  delete from public.intercambio_events where id=p_event_id and owner_id=v_user;
end;
$$;

create function intercambio_private.delete_account(p_confirmation text) returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if not coalesce(intercambio_private.is_organizer(),false) then
    raise exception 'Solo el organizador autorizado puede eliminar su cuenta de Intercambio.' using errcode='42501';
  end if;
  if p_confirmation is distinct from 'BORRAR CUENTA' then
    raise exception 'Escribe BORRAR CUENTA para confirmar.' using errcode='22023';
  end if;
  -- Do not first acquire require_organizer's shared lock: two deletion requests
  -- must queue here directly instead of competing to upgrade shared row locks.
  perform 1 from intercambio_private.organizer_access where user_id=v_user for update;
  if not found then raise exception 'La cuenta de Intercambio ya fue eliminada.' using errcode='42501'; end if;
  delete from public.intercambio_events where owner_id=v_user;
  delete from intercambio_private.organizer_access where user_id=v_user;
  -- The shared auth.users identity and every Stocka business table are retained.
end;
$$;

create function public.intercambio_guest_preview(p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$ select intercambio_private.guest_preview(p_token); $$;
create function public.intercambio_guest_register(p_token text,p_pin text) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.guest_register(p_token,p_pin); $$;
create function public.intercambio_guest_login(p_token text,p_pin text) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.guest_login(p_token,p_pin); $$;
create function public.intercambio_guest_profile(p_session_token text) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.guest_profile(p_session_token); $$;
create function public.intercambio_guest_assignment(p_session_token text,p_participant_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.guest_assignment(p_session_token,p_participant_id); $$;
create function public.intercambio_guest_save_wishes(p_session_token text,p_participant_id uuid,p_wishes text[],p_extra text default '') returns void
language sql security invoker set search_path='' as $$ select intercambio_private.guest_save_wishes(p_session_token,p_participant_id,p_wishes,p_extra); $$;
create function public.intercambio_guest_logout(p_session_token text) returns void
language sql security invoker set search_path='' as $$ select intercambio_private.guest_logout(p_session_token); $$;
create function public.intercambio_reset_pin(p_participant_id uuid) returns void
language sql security invoker set search_path='' as $$ select intercambio_private.reset_pin(p_participant_id); $$;
create function public.intercambio_delete_event(p_event_id uuid,p_confirmation text) returns void
language sql security invoker set search_path='' as $$ select intercambio_private.delete_event(p_event_id,p_confirmation); $$;
create function public.intercambio_delete_account(p_confirmation text) returns void
language sql security invoker set search_path='' as $$ select intercambio_private.delete_account(p_confirmation); $$;

-- New helpers default to EXECUTE PUBLIC; revoke every new signature explicitly.
revoke all on function intercambio_private.is_organizer(),intercambio_private.require_organizer(),
  intercambio_private.issue_guest_session(uuid),intercambio_private.guest_context(text),
  intercambio_private.guest_preview(text),intercambio_private.guest_register(text,text),
  intercambio_private.guest_login(text,text),intercambio_private.guest_profile(text),
  intercambio_private.guest_assignment(text,uuid),intercambio_private.guest_save_wishes(text,uuid,text[],text),
  intercambio_private.guest_logout(text),intercambio_private.reset_pin(uuid),intercambio_private.delete_event(uuid,text),intercambio_private.delete_account(text)
from public,anon,authenticated;
grant usage on schema intercambio_private to anon;
grant execute on function intercambio_private.is_organizer(),intercambio_private.require_organizer(),intercambio_private.reset_pin(uuid),intercambio_private.delete_event(uuid,text),intercambio_private.delete_account(text) to authenticated;
grant execute on function intercambio_private.guest_preview(text),intercambio_private.guest_register(text,text),
  intercambio_private.guest_login(text,text),intercambio_private.guest_profile(text),
  intercambio_private.guest_assignment(text,uuid),intercambio_private.guest_save_wishes(text,uuid,text[],text),
  intercambio_private.guest_logout(text) to anon,authenticated;
revoke all on function public.intercambio_is_organizer(),public.intercambio_reset_pin(uuid),public.intercambio_delete_event(uuid,text),public.intercambio_delete_account(text),
  public.intercambio_guest_preview(text),public.intercambio_guest_register(text,text),
  public.intercambio_guest_login(text,text),public.intercambio_guest_profile(text),
  public.intercambio_guest_assignment(text,uuid),public.intercambio_guest_save_wishes(text,uuid,text[],text),
  public.intercambio_guest_logout(text) from public,anon,authenticated;
grant execute on function public.intercambio_is_organizer(),public.intercambio_reset_pin(uuid),public.intercambio_delete_event(uuid,text),public.intercambio_delete_account(text) to authenticated;
grant execute on function public.intercambio_guest_preview(text),public.intercambio_guest_register(text,text),
  public.intercambio_guest_login(text,text),public.intercambio_guest_profile(text),
  public.intercambio_guest_assignment(text,uuid),public.intercambio_guest_save_wishes(text,uuid,text[],text),
  public.intercambio_guest_logout(text) to anon,authenticated;

-- Existing account-linked profiles keep their access, but new guest profiles
-- must use NIP access; no authenticated account can claim around the NIP.
revoke all on function public.intercambio_claim_participant(text),intercambio_private.claim_participant(text)
from public,anon,authenticated;

notify pgrst,'reload schema';
