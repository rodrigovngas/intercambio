-- Intercambio is isolated from other applications in this Supabase project.
-- Only the two prefixed public tables and prefixed RPCs are exposed to PostgREST.
create schema if not exists intercambio_private;
revoke all on schema intercambio_private from public, anon, authenticated;
grant usage on schema intercambio_private to authenticated, service_role;

create table if not exists public.intercambio_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  event_date date not null,
  budget text not null default 'Libre' check (length(trim(budget)) between 1 and 40),
  gift_type text not null default '' check (length(gift_type) <= 120),
  status text not null default 'draft' check (status in ('draft','drawn','archived')),
  invite_code text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  drawn_at timestamptz,
  legacy_id text unique,
  constraint intercambio_draw_state check (status <> 'drawn' or drawn_at is not null)
);
create index if not exists intercambio_events_owner_idx on public.intercambio_events(owner_id, created_at desc);

create table if not exists public.intercambio_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.intercambio_events(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  is_child boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  guardian_id uuid,
  wishes text[] not null default array['','','']::text[],
  extra text not null default '' check (length(extra) <= 1000),
  created_at timestamptz not null default now(),
  legacy_id text,
  unique(event_id,id),
  unique(event_id,user_id),
  unique(event_id,legacy_id),
  foreign key(event_id,guardian_id) references public.intercambio_participants(event_id,id) deferrable initially deferred,
  constraint intercambio_guardian_shape check (
    (is_child and user_id is null and guardian_id is not null and guardian_id <> id)
    or (not is_child and guardian_id is null)
  ),
  constraint intercambio_three_wishes check (
    cardinality(wishes) = 3 and array_ndims(wishes) = 1 and array_lower(wishes,1) = 1
    and array_position(wishes,null) is null
    and length(wishes[1]) <= 500 and length(wishes[2]) <= 500 and length(wishes[3]) <= 500
  )
);
create unique index if not exists intercambio_participants_name_idx on public.intercambio_participants(event_id,lower(trim(name)));
create index if not exists intercambio_participants_user_idx on public.intercambio_participants(user_id) where user_id is not null;
create index if not exists intercambio_participants_guardian_idx on public.intercambio_participants(guardian_id) where guardian_id is not null;

create table if not exists intercambio_private.participant_invites (
  participant_id uuid primary key,
  event_id uuid not null,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  claimed_at timestamptz,
  foreign key(event_id,participant_id) references public.intercambio_participants(event_id,id) on delete cascade
);
create index if not exists intercambio_invites_event_idx on intercambio_private.participant_invites(event_id);

create table if not exists intercambio_private.assignments (
  event_id uuid not null references public.intercambio_events(id) on delete cascade,
  giver_id uuid not null,
  receiver_id uuid not null,
  revealed_at timestamptz,
  primary key(event_id,giver_id),
  unique(event_id,receiver_id),
  check(giver_id <> receiver_id),
  foreign key(event_id,giver_id) references public.intercambio_participants(event_id,id) on delete cascade,
  foreign key(event_id,receiver_id) references public.intercambio_participants(event_id,id) on delete cascade
);

alter table public.intercambio_events enable row level security;
alter table public.intercambio_participants enable row level security;
alter table intercambio_private.participant_invites enable row level security;
alter table intercambio_private.assignments enable row level security;

-- Authenticated clients have read-only table access. All writes and all secret
-- reads go through narrowly scoped, identity-checked private functions.
revoke all on public.intercambio_events, public.intercambio_participants from anon, authenticated;
grant select on public.intercambio_events, public.intercambio_participants to authenticated;
grant all on public.intercambio_events, public.intercambio_participants to service_role;
revoke all on all tables in schema intercambio_private from public, anon, authenticated;
grant all on all tables in schema intercambio_private to service_role;

create or replace function intercambio_private.require_user() returns uuid
language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Inicia sesión para continuar.' using errcode = '42501'; end if;
  return v_user;
end;
$$;

create or replace function intercambio_private.can_manage_participant(p_participant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.intercambio_participants p
    left join public.intercambio_participants g on g.id = p.guardian_id and g.event_id = p.event_id
    where p.id = p_participant_id and (p.user_id = auth.uid() or g.user_id = auth.uid())
  );
$$;

create or replace function intercambio_private.can_view_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists(select 1 from public.intercambio_events e where e.id = p_event_id and e.owner_id = auth.uid())
    or exists(select 1 from public.intercambio_participants p where p.event_id = p_event_id and p.user_id = auth.uid())
  );
$$;

create or replace function intercambio_private.can_view_participant(p_participant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    intercambio_private.can_manage_participant(p_participant_id)
    or exists(select 1 from public.intercambio_participants p join public.intercambio_events e on e.id = p.event_id
      where p.id = p_participant_id and e.owner_id = auth.uid())
  );
$$;

drop policy if exists intercambio_events_read on public.intercambio_events;
create policy intercambio_events_read on public.intercambio_events for select to authenticated
using ((select intercambio_private.can_view_event(id)));
drop policy if exists intercambio_participants_read on public.intercambio_participants;
create policy intercambio_participants_read on public.intercambio_participants for select to authenticated
using ((select intercambio_private.can_view_participant(id)));

create or replace function intercambio_private.validate_guardian() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.is_child and not exists (
    select 1 from public.intercambio_participants g
    where g.id = new.guardian_id and g.event_id = new.event_id and not g.is_child
  ) then raise exception 'El dependiente necesita un responsable adulto del mismo evento.'; end if;
  return new;
end;
$$;
drop trigger if exists intercambio_guardian_valid on public.intercambio_participants;
create constraint trigger intercambio_guardian_valid after insert or update on public.intercambio_participants
deferrable initially deferred for each row execute function intercambio_private.validate_guardian();

create or replace function intercambio_private.create_event(
  p_title text, p_event_date date, p_budget text, p_gift_type text, p_participants jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := intercambio_private.require_user();
  v_event uuid; v_ids uuid[]; v_count integer; v_i integer; v_p jsonb;
  v_child boolean; v_guardian_index integer;
begin
  if jsonb_typeof(p_participants) is distinct from 'array' then raise exception 'La lista de participantes no es válida.'; end if;
  v_count := jsonb_array_length(p_participants);
  if v_count < 2 or v_count > 100 then raise exception 'Agrega entre 2 y 100 participantes.'; end if;
  insert into public.intercambio_events(owner_id,title,event_date,budget,gift_type)
  values(v_user,trim(p_title),p_event_date,trim(p_budget),trim(coalesce(p_gift_type,''))) returning id into v_event;
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

create or replace function intercambio_private.update_event(
  p_event_id uuid,p_title text,p_event_date date,p_budget text,p_gift_type text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user();
begin
  perform 1 from public.intercambio_events where id=p_event_id and owner_id=v_user for update;
  if not found then raise exception 'No tienes acceso a este evento.' using errcode='42501'; end if;
  update public.intercambio_events set title=trim(p_title),event_date=p_event_date,budget=trim(p_budget),gift_type=trim(coalesce(p_gift_type,'')) where id=p_event_id;
end;
$$;

create or replace function intercambio_private.add_participant(
  p_event_id uuid,p_name text,p_is_child boolean default false,p_guardian_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user(); v_status text; v_id uuid;
begin
  select status into v_status from public.intercambio_events where id=p_event_id and owner_id=v_user for update;
  if not found then raise exception 'No tienes acceso a este evento.' using errcode='42501'; end if;
  if v_status <> 'draft' then raise exception 'Solo puedes cambiar participantes antes del sorteo.'; end if;
  if (select count(*) from public.intercambio_participants where event_id=p_event_id) >= 100 then raise exception 'El máximo es 100 participantes.'; end if;
  if p_is_child and not exists(select 1 from public.intercambio_participants where id=p_guardian_id and event_id=p_event_id and not is_child) then
    raise exception 'Selecciona un responsable adulto del evento.';
  end if;
  insert into public.intercambio_participants(event_id,name,is_child,guardian_id)
    values(p_event_id,trim(p_name),p_is_child,p_guardian_id) returning id into v_id;
  if not p_is_child then insert into intercambio_private.participant_invites(participant_id,event_id) values(v_id,p_event_id); end if;
  return v_id;
end;
$$;

create or replace function intercambio_private.remove_participant(p_participant_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user(); v_event uuid; v_status text;
begin
  select event_id into v_event from public.intercambio_participants where id=p_participant_id;
  select status into v_status from public.intercambio_events where id=v_event and owner_id=v_user for update;
  if not found then raise exception 'No tienes acceso a este participante.' using errcode='42501'; end if;
  if v_status <> 'draft' then raise exception 'Solo puedes cambiar participantes antes del sorteo.'; end if;
  if exists(select 1 from public.intercambio_participants where guardian_id=p_participant_id) then raise exception 'Primero elimina o reasigna sus dependientes.'; end if;
  delete from public.intercambio_participants where id=p_participant_id;
end;
$$;

create or replace function intercambio_private.draw_event(p_event_id uuid,p_expected_drawn_at timestamptz default null) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := intercambio_private.require_user(); v_event public.intercambio_events;
  v_givers uuid[]; v_receivers uuid[]; v_count integer; v_i integer; v_attempt integer := 0;
  v_valid boolean; v_now timestamptz;
begin
  select * into v_event from public.intercambio_events where id=p_event_id and owner_id=v_user for update;
  if not found then raise exception 'No tienes acceso a este evento.' using errcode='42501'; end if;
  if v_event.status='archived' then raise exception 'Restaura el evento antes de sortear.'; end if;
  if v_event.drawn_at is distinct from p_expected_drawn_at then raise exception 'El sorteo cambió. Actualiza la página antes de volver a sortear.'; end if;
  select array_agg(id order by id),count(*)::integer into v_givers,v_count from public.intercambio_participants where event_id=p_event_id;
  if v_count < 2 then raise exception 'Agrega al menos dos participantes.'; end if;
  -- Uniform permutation followed by rejection of self assignments. PostgreSQL's
  -- gen_random_uuid uses cryptographically strong randomness (no Math.random).
  loop
    v_attempt := v_attempt + 1;
    select array_agg(id order by gen_random_uuid()) into v_receivers from public.intercambio_participants where event_id=p_event_id;
    v_valid := true;
    for v_i in 1..v_count loop
      if v_givers[v_i]=v_receivers[v_i] then v_valid:=false; exit; end if;
    end loop;
    exit when v_valid;
    if v_attempt >= 1000 then raise exception 'No se pudo generar el sorteo. Inténtalo de nuevo.'; end if;
  end loop;
  delete from intercambio_private.assignments where event_id=p_event_id;
  insert into intercambio_private.assignments(event_id,giver_id,receiver_id)
    select p_event_id,v_givers[i],v_receivers[i] from generate_series(1,v_count) as i;
  v_now := clock_timestamp();
  update public.intercambio_events set status='drawn',drawn_at=v_now where id=p_event_id;
  return v_now;
end;
$$;

create or replace function intercambio_private.archive_event(p_event_id uuid,p_archived boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user();
begin
  update public.intercambio_events set status=case when p_archived then 'archived' when drawn_at is null then 'draft' else 'drawn' end
    where id=p_event_id and owner_id=v_user;
  if not found then raise exception 'No tienes acceso a este evento.' using errcode='42501'; end if;
end;
$$;

create or replace function intercambio_private.get_participant_invites(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user(); v_result jsonb;
begin
  if not exists(select 1 from public.intercambio_events where id=p_event_id and owner_id=v_user) then
    raise exception 'No tienes acceso a las invitaciones.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('participant_id',p.id,'name',p.name,
    'token',case when p.user_id is null then i.token else null end,
    'claimed',p.user_id is not null,'revealed',a.revealed_at is not null) order by p.created_at,p.name),'[]'::jsonb)
  into v_result from public.intercambio_participants p
  join intercambio_private.participant_invites i on i.participant_id=p.id
  left join intercambio_private.assignments a on a.giver_id=p.id and a.event_id=p.event_id
  where p.event_id=p_event_id and not p.is_child;
  return v_result;
end;
$$;

create or replace function intercambio_private.preview_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user(); v_result jsonb;
begin
  if p_token is null or length(p_token) <> 64 then raise exception 'Invitación no válida.'; end if;
  select jsonb_build_object('event_id',e.id,'title',e.title,'event_date',e.event_date,'budget',e.budget,'gift_type',e.gift_type,
    'participant_id',p.id,'participant_name',p.name,'claimed',p.user_id is not null,'is_mine',p.user_id=v_user)
  into v_result from intercambio_private.participant_invites i
  join public.intercambio_participants p on p.id=i.participant_id
  join public.intercambio_events e on e.id=p.event_id
  where i.token=p_token and e.status<>'archived';
  if v_result is null then raise exception 'La invitación no existe o el evento está archivado.'; end if;
  return v_result;
end;
$$;

create or replace function intercambio_private.claim_participant(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user(); v_invite intercambio_private.participant_invites; v_p public.intercambio_participants; v_event uuid;
begin
  select event_id into v_event from intercambio_private.participant_invites where token=p_token;
  perform 1 from public.intercambio_events where id=v_event and status<>'archived' for update;
  if not found then raise exception 'La invitación no existe o el evento está archivado.'; end if;
  select * into v_invite from intercambio_private.participant_invites where token=p_token for update;
  select * into v_p from public.intercambio_participants where id=v_invite.participant_id for update;
  if v_p.user_id=v_user then return v_p.id; end if;
  if v_p.user_id is not null or v_invite.claimed_at is not null then raise exception 'Esta invitación ya fue utilizada.'; end if;
  if exists(select 1 from public.intercambio_participants where event_id=v_event and user_id=v_user) then raise exception 'Ya tienes un perfil en este evento.'; end if;
  update public.intercambio_participants set user_id=v_user where id=v_p.id;
  update intercambio_private.participant_invites set claimed_at=clock_timestamp() where participant_id=v_p.id;
  return v_p.id;
end;
$$;

create or replace function intercambio_private.get_my_assignment(p_participant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user(); v_result jsonb; v_event uuid;
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
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user();
begin
  if not intercambio_private.can_manage_participant(p_participant_id) then raise exception 'Solo puedes editar tu perfil o tus dependientes.' using errcode='42501'; end if;
  update public.intercambio_participants set wishes=p_wishes,extra=coalesce(p_extra,'') where id=p_participant_id;
end;
$$;

create or replace function intercambio_private.get_event_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := intercambio_private.require_user(); v_result jsonb;
begin
  select jsonb_build_object('event_id',id,'title',title,'event_date',event_date,'budget',budget,'gift_type',gift_type,'status',status)
  into v_result from public.intercambio_events where invite_code=p_code and status<>'archived';
  if v_result is null then raise exception 'El evento no existe o está archivado.'; end if;
  return v_result;
end;
$$;

-- PostgREST calls security-invoker wrappers. Privileged implementations stay in
-- a schema that must never be added to the Data API's exposed schemas.
create or replace function public.intercambio_create_event(p_title text,p_event_date date,p_budget text,p_gift_type text,p_participants jsonb) returns uuid
language sql security invoker set search_path='' as $$ select intercambio_private.create_event(p_title,p_event_date,p_budget,p_gift_type,p_participants); $$;
create or replace function public.intercambio_update_event(p_event_id uuid,p_title text,p_event_date date,p_budget text,p_gift_type text) returns void
language sql security invoker set search_path='' as $$ select intercambio_private.update_event(p_event_id,p_title,p_event_date,p_budget,p_gift_type); $$;
create or replace function public.intercambio_add_participant(p_event_id uuid,p_name text,p_is_child boolean default false,p_guardian_id uuid default null) returns uuid
language sql security invoker set search_path='' as $$ select intercambio_private.add_participant(p_event_id,p_name,p_is_child,p_guardian_id); $$;
create or replace function public.intercambio_remove_participant(p_participant_id uuid) returns void
language sql security invoker set search_path='' as $$ select intercambio_private.remove_participant(p_participant_id); $$;
create or replace function public.intercambio_draw_event(p_event_id uuid,p_expected_drawn_at timestamptz default null) returns timestamptz
language sql security invoker set search_path='' as $$ select intercambio_private.draw_event(p_event_id,p_expected_drawn_at); $$;
create or replace function public.intercambio_archive_event(p_event_id uuid,p_archived boolean default true) returns void
language sql security invoker set search_path='' as $$ select intercambio_private.archive_event(p_event_id,p_archived); $$;
create or replace function public.intercambio_get_participant_invites(p_event_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select intercambio_private.get_participant_invites(p_event_id); $$;
create or replace function public.intercambio_preview_invite(p_token text) returns jsonb
language sql stable security invoker set search_path='' as $$ select intercambio_private.preview_invite(p_token); $$;
create or replace function public.intercambio_claim_participant(p_token text) returns uuid
language sql security invoker set search_path='' as $$ select intercambio_private.claim_participant(p_token); $$;
create or replace function public.intercambio_get_my_assignment(p_participant_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select intercambio_private.get_my_assignment(p_participant_id); $$;
create or replace function public.intercambio_save_wishes(p_participant_id uuid,p_wishes text[],p_extra text default '') returns void
language sql security invoker set search_path='' as $$ select intercambio_private.save_wishes(p_participant_id,p_wishes,p_extra); $$;
create or replace function public.intercambio_get_event_preview(p_code text) returns jsonb
language sql stable security invoker set search_path='' as $$ select intercambio_private.get_event_preview(p_code); $$;

revoke all on all functions in schema intercambio_private from public, anon, authenticated;
grant execute on function intercambio_private.require_user() to authenticated;
grant execute on function intercambio_private.can_manage_participant(uuid),intercambio_private.can_view_event(uuid),intercambio_private.can_view_participant(uuid) to authenticated;
grant execute on function intercambio_private.create_event(text,date,text,text,jsonb),intercambio_private.update_event(uuid,text,date,text,text),intercambio_private.add_participant(uuid,text,boolean,uuid),intercambio_private.remove_participant(uuid),intercambio_private.draw_event(uuid,timestamptz),intercambio_private.archive_event(uuid,boolean),intercambio_private.get_participant_invites(uuid),intercambio_private.preview_invite(text),intercambio_private.claim_participant(text),intercambio_private.get_my_assignment(uuid),intercambio_private.save_wishes(uuid,text[],text),intercambio_private.get_event_preview(text) to authenticated;

do $$
declare v_function record;
begin
  for v_function in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'intercambio\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated',v_function.signature);
    execute format('grant execute on function %s to authenticated',v_function.signature);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
