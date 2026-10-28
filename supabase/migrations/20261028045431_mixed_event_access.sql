-- All verified users can use account-backed events. Only the existing private
-- allowlist grants the optional NIP guest mode. No shared Auth/Stocka rows change.
create table intercambio_private.application_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table intercambio_private.application_accounts enable row level security;
revoke all on intercambio_private.application_accounts from public,anon,authenticated;
grant all on intercambio_private.application_accounts to service_role;

-- Carry forward the original organizer's active/deleted application state.
insert into intercambio_private.application_accounts(user_id,deleted_at)
select u.id,case when a.user_id is null then clock_timestamp() else null end
from auth.users u left join intercambio_private.organizer_access a on a.user_id=u.id
where u.id='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'::uuid;
insert into intercambio_private.application_accounts(user_id)
select u.id from auth.users u where u.email is not null and u.email_confirmed_at is not null
  and (exists(select 1 from public.intercambio_events e where e.owner_id=u.id)
    or exists(select 1 from public.intercambio_participants p where p.user_id=u.id))
on conflict(user_id) do nothing;

create function intercambio_private.is_verified_user() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from auth.users u
    where u.id=auth.uid() and nullif(trim(u.email),'') is not null
      and u.email_confirmed_at is not null
      and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false));
$$;
create or replace function intercambio_private.is_organizer() returns boolean
language sql stable security definer set search_path='' as $$
  select intercambio_private.is_verified_user() and exists(
    select 1 from intercambio_private.application_accounts a
    where a.user_id=auth.uid() and a.deleted_at is null);
$$;
create function intercambio_private.has_pin_privilege(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_user_id='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'::uuid and exists(
    select 1 from auth.users u
    join intercambio_private.organizer_access privileged on privileged.user_id=u.id
    join intercambio_private.application_accounts a on a.user_id=u.id and a.deleted_at is null
    where u.id=p_user_id and u.email_confirmed_at is not null
      and nullif(trim(u.email),'') is not null
      and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)
      and privileged.email_hash=encode(extensions.digest(lower(u.email),'sha256'),'hex'));
$$;
create function intercambio_private.account_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_deleted timestamptz;
begin
  if not intercambio_private.is_verified_user() then
    return jsonb_build_object('can_organize',false,'can_use_pin',false,'deleted',false);
  end if;
  -- First entry into this application explicitly enrolls the verified Auth user.
  -- A previous deletion is a tombstone and is never silently reactivated.
  insert into intercambio_private.application_accounts(user_id) values(v_user)
    on conflict(user_id) do nothing;
  select deleted_at into v_deleted from intercambio_private.application_accounts
    where user_id=v_user for share;
  return jsonb_build_object('can_organize',v_deleted is null,
    'can_use_pin',v_deleted is null and intercambio_private.has_pin_privilege(v_user),
    'deleted',v_deleted is not null);
end;
$$;
create or replace function intercambio_private.require_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if not intercambio_private.is_organizer() then
    raise exception 'Inicia sesión con una cuenta verificada y activa de Intercambio.' using errcode='42501';
  end if;
  return auth.uid();
end;
$$;
create or replace function intercambio_private.require_organizer() returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if not intercambio_private.is_organizer() then
    raise exception 'Inicia sesión con una cuenta verificada y activa de Intercambio.' using errcode='42501';
  end if;
  perform 1 from intercambio_private.application_accounts
    where user_id=auth.uid() and deleted_at is null for share;
  if not found then raise exception 'La cuenta de Intercambio fue eliminada.' using errcode='42501'; end if;
  return auth.uid();
end;
$$;

-- Every account table read still requires ownership or a claimed personal profile.
create or replace function intercambio_private.can_manage_participant(p_participant_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select intercambio_private.is_organizer() and exists(
    select 1 from public.intercambio_participants p
    left join public.intercambio_participants g on g.id=p.guardian_id and g.event_id=p.event_id
    where p.id=p_participant_id and (p.user_id=auth.uid() or g.user_id=auth.uid()));
$$;
create or replace function intercambio_private.can_view_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select intercambio_private.is_organizer() and (
    exists(select 1 from public.intercambio_events e where e.id=p_event_id and e.owner_id=auth.uid())
    or exists(select 1 from public.intercambio_participants p where p.event_id=p_event_id and p.user_id=auth.uid()));
$$;
create or replace function intercambio_private.can_view_participant(p_participant_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select intercambio_private.is_organizer() and (
    intercambio_private.can_manage_participant(p_participant_id)
    or exists(select 1 from public.intercambio_participants p
      join public.intercambio_events e on e.id=p.event_id
      where p.id=p_participant_id and e.owner_id=auth.uid()));
$$;

alter table public.intercambio_events add column guest_access_mode text not null default 'account'
  check(guest_access_mode in ('account','pin'));
-- Existing NIP invitations keep working for events created under that privilege.
update public.intercambio_events e set guest_access_mode='pin'
  where intercambio_private.has_pin_privilege(e.owner_id);


create or replace function intercambio_private.create_event(
  p_title text, p_event_date date, p_budget text, p_gift_type text, p_participants jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := intercambio_private.require_organizer();
  v_event uuid; v_ids uuid[]; v_count integer; v_i integer; v_p jsonb;
  v_child boolean; v_guardian_index integer;
begin
  if jsonb_typeof(p_participants) is distinct from 'array' then raise exception 'La lista de participantes no es válida.'; end if;
  v_count := jsonb_array_length(p_participants);
  if v_count < 2 or v_count > 100 then raise exception 'Agrega entre 2 y 100 participantes.'; end if;
  insert into public.intercambio_events(owner_id,title,event_date,budget,gift_type,guest_access_mode)
  values(v_user,trim(p_title),p_event_date,trim(p_budget),trim(coalesce(p_gift_type,'')),
    case when intercambio_private.has_pin_privilege(v_user) then 'pin' else 'account' end) returning id into v_event;
  select array_agg(gen_random_uuid()) into v_ids from generate_series(1,v_count);
  -- Adults are inserted first; dependent indexes refer to the original array.
  for v_i in 0..v_count-1 loop
    v_p := p_participants->v_i;
    if not coalesce((v_p->>'is_child')::boolean,false) then
      insert into public.intercambio_participants(id,event_id,name) values(v_ids[v_i+1],v_event,trim(v_p->>'name'));
      insert into intercambio_private.participant_invites(participant_id,event_id) values(v_ids[v_i+1],v_event);
    end if;
  end loop;
  for v_i in 0..v_count-1 loop
    v_p := p_participants->v_i;
    v_child := coalesce((v_p->>'is_child')::boolean,false);
    if v_child then
      v_guardian_index := (v_p->>'guardian_index')::integer;
      if v_guardian_index is null or v_guardian_index < 0 or v_guardian_index >= v_count
        or coalesce((p_participants->v_guardian_index->>'is_child')::boolean,false) then
        raise exception 'Selecciona un responsable adulto para cada dependiente.';
      end if;
      insert into public.intercambio_participants(id,event_id,name,is_child,guardian_id)
      values(v_ids[v_i+1],v_event,trim(v_p->>'name'),true,v_ids[v_guardian_index+1]);
    end if;
  end loop;
  return v_event;
end;
$$;


create function intercambio_private.create_event_with_access(
  p_title text,p_event_date date,p_budget text,p_gift_type text,p_participants jsonb,p_guest_access_mode text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_event uuid; v_mode text;
begin
  v_mode:=coalesce(p_guest_access_mode,case when intercambio_private.has_pin_privilege(v_user) then 'pin' else 'account' end);
  if v_mode not in ('account','pin') then raise exception 'El modo de acceso no es válido.' using errcode='22023'; end if;
  if v_mode='pin' and not intercambio_private.has_pin_privilege(v_user) then
    raise exception 'Tu cuenta no tiene el privilegio de invitar sin registro.' using errcode='42501';
  end if;
  v_event:=intercambio_private.create_event(p_title,p_event_date,p_budget,p_gift_type,p_participants);
  update public.intercambio_events set guest_access_mode=v_mode where id=v_event;
  return v_event;
end;
$$;
create or replace function intercambio_private.guest_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then
    raise exception 'La invitación no es válida.' using errcode='22023';
  end if;
  select jsonb_build_object('event_id',e.id,'title',e.title,'event_date',e.event_date,
    'budget',e.budget,'gift_type',e.gift_type,'status',e.status,'drawn_at',e.drawn_at,
    'guest_access_mode',e.guest_access_mode,'participant_id',p.id,'participant_name',p.name,
    'has_pin',e.guest_access_mode='pin' and c.participant_id is not null,
    'claimed',case when e.guest_access_mode='pin' then c.participant_id is not null else p.user_id is not null end,
    'is_mine',coalesce(p.user_id=auth.uid(),false)) into v_result
  from intercambio_private.participant_invites i
  join public.intercambio_participants p on p.id=i.participant_id and p.event_id=i.event_id
  join public.intercambio_events e on e.id=p.event_id
  left join intercambio_private.pin_credentials c on c.participant_id=p.id
  where i.token=p_token and not p.is_child and e.status<>'archived';
  if v_result is null then raise exception 'La invitación no existe o el evento está archivado.' using errcode='22023'; end if;
  return v_result;
end;
$$;
create or replace function intercambio_private.preview_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform intercambio_private.require_user();
  return intercambio_private.guest_preview(p_token);
end;
$$;
create or replace function intercambio_private.claim_participant(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_event uuid; v_mode text;
  v_invite intercambio_private.participant_invites; v_person public.intercambio_participants;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception 'La invitación no es válida.' using errcode='22023'; end if;
  select event_id into v_event from intercambio_private.participant_invites where token=p_token;
  select guest_access_mode into v_mode from public.intercambio_events
    where id=v_event and status<>'archived' for update;
  if not found then raise exception 'La invitación no existe o el evento está archivado.' using errcode='22023'; end if;
  if v_mode<>'account' then raise exception 'Esta invitación utiliza NIP. Abre el enlace personal para entrar.' using errcode='42501'; end if;
  select * into v_invite from intercambio_private.participant_invites where token=p_token for update;
  select * into v_person from public.intercambio_participants where id=v_invite.participant_id and event_id=v_event for update;
  if v_person.is_child or v_person.id is null then raise exception 'La invitación no es válida.' using errcode='22023'; end if;
  if v_person.user_id=v_user then return v_person.id; end if;
  if v_person.user_id is not null or v_invite.claimed_at is not null then raise exception 'Esta invitación ya fue utilizada.' using errcode='42501'; end if;
  if exists(select 1 from public.intercambio_participants where event_id=v_event and user_id=v_user) then
    raise exception 'Ya tienes un perfil en este evento.' using errcode='42501';
  end if;
  update public.intercambio_participants set user_id=v_user where id=v_person.id;
  update intercambio_private.participant_invites set claimed_at=clock_timestamp() where participant_id=v_person.id;
  return v_person.id;
end;
$$;
create or replace function intercambio_private.get_participant_invites(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_mode text; v_result jsonb;
begin
  select guest_access_mode into v_mode from public.intercambio_events where id=p_event_id and owner_id=v_user;
  if not found then raise exception 'No tienes acceso a las invitaciones.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('participant_id',p.id,'name',p.name,'token',i.token,
    'guest_access_mode',v_mode,
    'claimed',case when v_mode='pin' then c.participant_id is not null else p.user_id is not null end,
    'has_pin',v_mode='pin' and c.participant_id is not null,'account_linked',p.user_id is not null,
    'revealed',a.revealed_at is not null) order by p.created_at,p.name),'[]'::jsonb) into v_result
  from public.intercambio_participants p
  join intercambio_private.participant_invites i on i.participant_id=p.id
  left join intercambio_private.pin_credentials c on c.participant_id=p.id
  left join intercambio_private.assignments a on a.event_id=p.event_id and a.giver_id=p.id
  where p.event_id=p_event_id and not p.is_child;
  return v_result;
end;
$$;


create or replace function intercambio_private.guest_register(p_token text,p_pin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_participant uuid;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'error','La invitación no es válida.'); end if;
  if p_pin is null or p_pin!~'^[0-9]{6}$' then return jsonb_build_object('ok',false,'error','El NIP debe tener exactamente seis números.'); end if;
  select i.event_id into v_event from intercambio_private.participant_invites i where i.token=p_token;
  -- All guest mutation paths lock event -> invitation -> credential/session.
  -- This serializes registration/reset/removal without weakening RLS.
  perform 1 from public.intercambio_events where id=v_event and status<>'archived' and guest_access_mode='pin' for share;
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

create or replace function intercambio_private.guest_login(p_token text,p_pin text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_participant uuid; v_credentials intercambio_private.pin_credentials; v_attempts integer; v_now timestamptz:=clock_timestamp();
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'error','La invitación no es válida.'); end if;
  if p_pin is null or p_pin!~'^[0-9]{6}$' then return jsonb_build_object('ok',false,'error','El NIP debe tener exactamente seis números.'); end if;
  select event_id into v_event from intercambio_private.participant_invites where token=p_token;
  perform 1 from public.intercambio_events where id=v_event and status<>'archived' and guest_access_mode='pin' for share;
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

create or replace function intercambio_private.guest_context(p_session_token text)
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
  perform 1 from public.intercambio_events e where e.id=v_event and e.status<>'archived' and e.guest_access_mode='pin' for share;
  if found then
    return query select s.participant_id,p.event_id,s.expires_at from intercambio_private.guest_sessions s
      join public.intercambio_participants p on p.id=s.participant_id
      where s.token_hash=v_hash and s.expires_at>clock_timestamp() and not p.is_child for share of s;
    if found then return; end if;
  end if;
  raise exception 'Tu sesión de invitado terminó. Abre tu invitación e ingresa tu NIP de nuevo.' using errcode='28000';
end;
$$;


create or replace function intercambio_private.guest_profile(p_session_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_context record; v_result jsonb;
begin
  select * into strict v_context from intercambio_private.guest_context(p_session_token);
  select jsonb_build_object('participant_id',v_context.participant_id,'expires_at',v_context.expires_at,
    'event',jsonb_build_object('id',e.id,'title',e.title,'event_date',e.event_date,'budget',e.budget,
      'gift_type',e.gift_type,'status',e.status,'drawn_at',e.drawn_at,'guest_access_mode',e.guest_access_mode),
    'profiles',(select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_child',p.is_child,
      'wishes',p.wishes,'extra',p.extra,'revealed',a.revealed_at is not null)
      order by p.is_child,p.created_at,p.name) from public.intercambio_participants p
      left join intercambio_private.assignments a on a.event_id=p.event_id and a.giver_id=p.id
      where p.event_id=e.id and (p.id=v_context.participant_id or p.guardian_id=v_context.participant_id)))
  into v_result from public.intercambio_events e where e.id=v_context.event_id;
  return v_result;
end;
$$;
create function intercambio_private.my_profile_state(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_result jsonb;
begin
  if not intercambio_private.can_view_event(p_event_id) then raise exception 'No tienes acceso a este evento.' using errcode='42501'; end if;
  perform 1 from public.intercambio_events where id=p_event_id for share;
  select jsonb_build_object('drawn_at',e.drawn_at,'profiles',coalesce((
    select jsonb_agg(jsonb_build_object('id',p.id,'revealed',a.revealed_at is not null) order by p.id)
    from public.intercambio_participants p
    left join public.intercambio_participants guardian on guardian.id=p.guardian_id and guardian.event_id=p.event_id
    left join intercambio_private.assignments a on a.event_id=p.event_id and a.giver_id=p.id
    where p.event_id=e.id and (p.user_id=v_user or guardian.user_id=v_user)),'[]'::jsonb))
  into v_result from public.intercambio_events e where e.id=p_event_id;
  return v_result;
end;
$$;


create or replace function intercambio_private.get_my_assignment(p_participant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_organizer(); v_result jsonb; v_event uuid;
begin
  if not intercambio_private.can_manage_participant(p_participant_id) then raise exception 'Este resultado es privado.' using errcode='42501'; end if;
  select event_id into v_event from public.intercambio_participants where id=p_participant_id;
  -- Serialize with redraw so a reveal cannot return a partially replaced draw.
  perform 1 from public.intercambio_events where id=v_event for share;
  select jsonb_build_object('participant_id',p_participant_id,'target_id',p.id,'target_name',p.name,'wishes',p.wishes,'extra',p.extra)
  into v_result from intercambio_private.assignments a join public.intercambio_participants p on p.id=a.receiver_id
  where a.giver_id=p_participant_id and a.event_id=v_event;
  if v_result is null then raise exception 'El sorteo todavía no se ha realizado.'; end if;
  update intercambio_private.assignments set revealed_at=coalesce(revealed_at,clock_timestamp()) where giver_id=p_participant_id and event_id=v_event;
  return v_result;
end;
$$;


create or replace function intercambio_private.save_wishes(p_participant_id uuid,p_wishes text[],p_extra text default '') returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_event uuid;
begin
  select event_id into v_event from public.intercambio_participants where id=p_participant_id;
  perform 1 from public.intercambio_events where id=v_event for share;
  if not intercambio_private.can_manage_participant(p_participant_id) then
    raise exception 'Solo puedes editar tu perfil o tus dependientes.' using errcode='42501';
  end if;
  update public.intercambio_participants set wishes=p_wishes,extra=coalesce(p_extra,'') where id=p_participant_id;
end;
$$;


create or replace function intercambio_private.reset_pin(p_participant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_event uuid;
begin
  select event_id into v_event from public.intercambio_participants where id=p_participant_id and not is_child;
  perform 1 from public.intercambio_events where id=v_event and owner_id=v_user and guest_access_mode='pin' for update;
  if not found then raise exception 'No tienes acceso a este participante.' using errcode='42501'; end if;
  -- The FK cascade invalidates all of this guest's sessions, preserving wishes,
  -- dependent relationships and the draw. The existing invitation remains valid.
  delete from intercambio_private.pin_credentials where participant_id=p_participant_id;
end;
$$;


create function intercambio_private.restore_my_assignment(p_participant_id uuid,p_expected_drawn_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=intercambio_private.require_organizer(); v_event uuid; v_drawn timestamptz; v_result jsonb;
begin
  if not intercambio_private.can_manage_participant(p_participant_id) then
    raise exception 'Este resultado es privado.' using errcode='42501';
  end if;
  select event_id into v_event from public.intercambio_participants where id=p_participant_id;
  select drawn_at into v_drawn from public.intercambio_events where id=v_event for share;
  if v_drawn is distinct from p_expected_drawn_at then return null; end if;
  select jsonb_build_object('participant_id',p_participant_id,'target_id',p.id,'target_name',p.name,'wishes',p.wishes,'extra',p.extra)
  into v_result from intercambio_private.assignments a
    join public.intercambio_participants p on p.id=a.receiver_id and p.event_id=a.event_id
  where a.event_id=v_event and a.giver_id=p_participant_id and a.revealed_at is not null;
  return v_result;
end;
$$;
create function intercambio_private.guest_restore_assignment(p_session_token text,p_participant_id uuid,p_expected_drawn_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_context record; v_drawn timestamptz; v_result jsonb;
begin
  select * into strict v_context from intercambio_private.guest_context(p_session_token);
  if not exists(select 1 from public.intercambio_participants p where p.id=p_participant_id
    and p.event_id=v_context.event_id and (p.id=v_context.participant_id or p.guardian_id=v_context.participant_id)) then
    raise exception 'Este resultado es privado.' using errcode='42501';
  end if;
  select drawn_at into v_drawn from public.intercambio_events where id=v_context.event_id;
  if v_drawn is distinct from p_expected_drawn_at then return null; end if;
  select jsonb_build_object('participant_id',p_participant_id,'target_id',p.id,'target_name',p.name,'wishes',p.wishes,'extra',p.extra)
  into v_result from intercambio_private.assignments a
    join public.intercambio_participants p on p.id=a.receiver_id and p.event_id=a.event_id
  where a.event_id=v_context.event_id and a.giver_id=p_participant_id and a.revealed_at is not null;
  return v_result;
end;
$$;

create or replace function intercambio_private.delete_account(p_confirmation text) returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if not intercambio_private.is_verified_user() then raise exception 'Inicia sesión para borrar tu cuenta de Intercambio.' using errcode='42501'; end if;
  if p_confirmation is distinct from 'BORRAR CUENTA' then raise exception 'Escribe BORRAR CUENTA para confirmar.' using errcode='22023'; end if;
  perform 1 from intercambio_private.application_accounts where user_id=v_user and deleted_at is null for update;
  if not found then raise exception 'La cuenta de Intercambio ya fue eliminada.' using errcode='42501'; end if;
  -- Lock all affected events in one order. Other owners' events and draws stay.
  perform 1 from public.intercambio_events e where e.owner_id=v_user
    or exists(select 1 from public.intercambio_participants p where p.event_id=e.id and p.user_id=v_user)
    order by e.id for update;
  -- Revoke the departed person's old invitation in someone else's event.
  update intercambio_private.participant_invites i set
    token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),claimed_at=null
  from public.intercambio_participants p,public.intercambio_events e
  where i.participant_id=p.id and p.event_id=e.id and p.user_id=v_user and e.owner_id<>v_user;
  delete from intercambio_private.pin_credentials c using public.intercambio_participants p
    where c.participant_id=p.id and p.user_id=v_user;
  update intercambio_private.assignments a set revealed_at=null
    from public.intercambio_participants p
    where a.giver_id=p.id and a.event_id=p.event_id and
      (p.user_id=v_user or p.guardian_id in(select adult.id from public.intercambio_participants adult where adult.user_id=v_user));
  update public.intercambio_participants p set wishes=array['','','']::text[],extra=''
    where p.user_id=v_user or p.guardian_id in(select adult.id from public.intercambio_participants adult where adult.user_id=v_user);
  update public.intercambio_participants set user_id=null where user_id=v_user;
  delete from public.intercambio_events where owner_id=v_user;
  delete from intercambio_private.organizer_access where user_id=v_user;
  update intercambio_private.application_accounts set deleted_at=clock_timestamp() where user_id=v_user;
  -- No write to auth.users, Stocka profiles, memberships or business records.
end;
$$;

create function public.intercambio_account_status() returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.account_status(); $$;
create function public.intercambio_create_event_with_access(
  p_title text,p_event_date date,p_budget text,p_gift_type text,p_participants jsonb,p_guest_access_mode text
) returns uuid language sql security invoker set search_path='' as $$
  select intercambio_private.create_event_with_access(p_title,p_event_date,p_budget,p_gift_type,p_participants,p_guest_access_mode);
$$;
create function public.intercambio_my_profile_state(p_event_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.my_profile_state(p_event_id); $$;

create function public.intercambio_restore_my_assignment(p_participant_id uuid,p_expected_drawn_at timestamptz) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.restore_my_assignment(p_participant_id,p_expected_drawn_at); $$;
create function public.intercambio_guest_restore_assignment(p_session_token text,p_participant_id uuid,p_expected_drawn_at timestamptz) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.guest_restore_assignment(p_session_token,p_participant_id,p_expected_drawn_at); $$;

revoke all on function intercambio_private.restore_my_assignment(uuid,timestamptz),
  intercambio_private.guest_restore_assignment(text,uuid,timestamptz),
  public.intercambio_restore_my_assignment(uuid,timestamptz),
  public.intercambio_guest_restore_assignment(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function intercambio_private.restore_my_assignment(uuid,timestamptz),
  public.intercambio_restore_my_assignment(uuid,timestamptz) to authenticated;
grant execute on function intercambio_private.guest_restore_assignment(text,uuid,timestamptz),
  public.intercambio_guest_restore_assignment(text,uuid,timestamptz) to anon,authenticated;

revoke all on function intercambio_private.is_verified_user(),intercambio_private.has_pin_privilege(uuid),
  intercambio_private.account_status(),intercambio_private.create_event_with_access(text,date,text,text,jsonb,text),
  intercambio_private.my_profile_state(uuid) from public,anon,authenticated;
-- Helper capability checks remain private; only the narrow public wrappers call
-- their guarded implementations. Existing RLS helpers retain existing grants.
grant execute on function intercambio_private.account_status(),
  intercambio_private.create_event_with_access(text,date,text,text,jsonb,text),
  intercambio_private.my_profile_state(uuid) to authenticated;
revoke all on function public.intercambio_account_status(),
  public.intercambio_create_event_with_access(text,date,text,text,jsonb,text),
  public.intercambio_my_profile_state(uuid) from public,anon,authenticated;
grant execute on function public.intercambio_account_status(),
  public.intercambio_create_event_with_access(text,date,text,text,jsonb,text),
  public.intercambio_my_profile_state(uuid) to authenticated;
-- Account events use verified accounts instead of anonymous NIP sessions.
grant execute on function public.intercambio_claim_participant(text),intercambio_private.claim_participant(text) to authenticated;
notify pgrst,'reload schema';
