-- Integration checks for real PostgreSQL/pgcrypto. All test records are rolled back.
-- The verified organizer must already exist (the local harness seeds that fixture).
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  ('20000000-0000-4000-8000-000000000001','pin-outsider@example.invalid',now(),
   '{"email":"claimed-organizer@example.invalid","full_name":"Organizador"}'::jsonb);
do $$ begin
  perform set_config('pin_test.user_count',(select count(*)::text from auth.users),true);
  perform set_config('pin_test.organizer_email',(select email from auth.users where id='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'),true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ca6ba7f9-77c8-4795-9d00-fb493fa29bbb',true);
select set_config('request.jwt.claims','{"sub":"ca6ba7f9-77c8-4795-9d00-fb493fa29bbb","role":"authenticated"}',true);
do $$
declare v_event uuid; v_invites jsonb;
begin
  if not public.intercambio_is_organizer() then raise exception 'Verified organizer was rejected'; end if;
  v_event:=public.intercambio_create_event('__PIN_SECURITY_TEST__','2026-12-24','Libre','Libros',
    '[{"name":"Ana"},{"name":"Beto"},{"name":"Caro"},{"name":"Dani","is_child":true,"guardian_index":0}]'::jsonb);
  perform set_config('pin_test.event',v_event::text,true);
  perform set_config('pin_test.ana',(select id::text from public.intercambio_participants where event_id=v_event and name='Ana'),true);
  perform set_config('pin_test.beto',(select id::text from public.intercambio_participants where event_id=v_event and name='Beto'),true);
  perform set_config('pin_test.child',(select id::text from public.intercambio_participants where event_id=v_event and name='Dani'),true);
  v_invites:=public.intercambio_get_participant_invites(v_event);
  if jsonb_array_length(v_invites)<>3 then raise exception 'Dependent has its own invitation'; end if;
  perform set_config('pin_test.ana_invite',(select x->>'token' from jsonb_array_elements(v_invites) x where x->>'name'='Ana'),true);
  perform set_config('pin_test.beto_invite',(select x->>'token' from jsonb_array_elements(v_invites) x where x->>'name'='Beto'),true);
  perform public.intercambio_draw_event(v_event);
end $$;
reset role;
-- Simulate a profile linked before migration; new account claims are disabled.
update public.intercambio_participants set user_id='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'
  where id=current_setting('pin_test.beto')::uuid;
set local role authenticated;
do $$ declare v_invites jsonb; v_other uuid;
begin
  v_invites:=public.intercambio_get_participant_invites(current_setting('pin_test.event')::uuid);
  if not exists(select 1 from jsonb_array_elements(v_invites) x where x->>'name'='Beto'
    and (x->>'account_linked')::boolean and x->>'token' is not null) then
    raise exception 'Account-linked participant lost its personal invitation';
  end if;
  begin
    perform public.intercambio_claim_participant(current_setting('pin_test.ana_invite'));
    raise exception 'Legacy account-claim endpoint remained available';
  exception when insufficient_privilege then null; end;
  v_other:=public.intercambio_create_event('__PIN_DELETE_KEEP__','2026-12-24','Libre','',
    '[{"name":"Keep A"},{"name":"Keep B"}]'::jsonb);
  perform set_config('pin_test.other_event',v_other::text,true);
end $$;

-- A different Supabase account cannot become an organizer via user metadata.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"email":"claimed-organizer@example.invalid"}}',true);
do $$ begin
  if public.intercambio_is_organizer() then raise exception 'Editable metadata conferred organizer access'; end if;
  begin
    perform public.intercambio_create_event('Unauthorized','2026-12-24','Libre','', '[{"name":"X"},{"name":"Y"}]'::jsonb);
    raise exception 'Unauthorized user created an event';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_reset_pin(current_setting('pin_test.ana')::uuid);
    raise exception 'Unauthorized user reset a PIN';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_delete_event(current_setting('pin_test.event')::uuid,'ELIMINAR');
    raise exception 'Unauthorized user deleted an event';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_delete_account('BORRAR CUENTA');
    raise exception 'Unauthorized user deleted the organizer account';
  exception when insufficient_privilege then null; end;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare v_preview jsonb; v_response jsonb; v_profile jsonb; v_assignment jsonb;
begin
  v_preview:=public.intercambio_guest_preview(current_setting('pin_test.ana_invite'));
  if v_preview->>'participant_name'<>'Ana' or (v_preview->>'has_pin')::boolean then raise exception 'Initial guest preview is invalid'; end if;
  if v_preview ?| array['pin_hash','session_token','wishes','assignments','target_name','participants'] then raise exception 'Preview exposes private data'; end if;
  begin
    perform public.intercambio_guest_preview(repeat('0',64));
    raise exception 'Unknown invitation was accepted';
  exception when invalid_parameter_value then null; end;
  v_response:=public.intercambio_guest_register(current_setting('pin_test.ana_invite'),'12345');
  if (v_response->>'ok')::boolean then raise exception 'Short PIN was accepted'; end if;
  v_response:=public.intercambio_guest_register(current_setting('pin_test.ana_invite'),'abcdef');
  if (v_response->>'ok')::boolean then raise exception 'Non-numeric PIN was accepted'; end if;
  v_response:=public.intercambio_guest_register(current_setting('pin_test.ana_invite'),'041029');
  if not (v_response->>'ok')::boolean or v_response->>'session_token' !~ '^[a-f0-9]{64}$' then raise exception 'Anonymous registration failed'; end if;
  if (v_response->>'expires_at')::timestamptz not between clock_timestamp()+interval '11 hours 59 minutes' and clock_timestamp()+interval '12 hours 1 minute' then raise exception 'Guest session lifetime is incorrect'; end if;
  perform set_config('pin_test.ana_session',v_response->>'session_token',true);
  v_preview:=public.intercambio_guest_preview(current_setting('pin_test.ana_invite'));
  if not (v_preview->>'has_pin')::boolean then raise exception 'Registered PIN is not detected'; end if;
  v_response:=public.intercambio_guest_register(current_setting('pin_test.ana_invite'),'999999');
  if (v_response->>'ok')::boolean then raise exception 'Duplicate registration overwrote the PIN'; end if;
  v_profile:=public.intercambio_guest_profile(current_setting('pin_test.ana_session'));
  if jsonb_array_length(v_profile->'profiles')<>2 then raise exception 'Guest must see exactly own and dependent profiles'; end if;
  if exists(select 1 from jsonb_array_elements(v_profile->'profiles') p where p->>'name' not in ('Ana','Dani')) then raise exception 'Other identities leaked in guest profile'; end if;
  if v_profile ?| array['pin_hash','session_token','assignments','target_name'] then raise exception 'Profile exposed secrets before reveal'; end if;
  perform public.intercambio_guest_save_wishes(current_setting('pin_test.ana_session'),current_setting('pin_test.ana')::uuid,array['Libro','Taza','Calcetas'],'Azul');
  perform public.intercambio_guest_save_wishes(current_setting('pin_test.ana_session'),current_setting('pin_test.child')::uuid,array['Rompecabezas','',''],'Talla 8');
  v_assignment:=public.intercambio_guest_assignment(current_setting('pin_test.ana_session'),current_setting('pin_test.ana')::uuid);
  if v_assignment->>'target_id'=current_setting('pin_test.ana') then raise exception 'Guest received a self assignment'; end if;
  perform public.intercambio_guest_assignment(current_setting('pin_test.ana_session'),current_setting('pin_test.child')::uuid);
  begin
    perform public.intercambio_guest_assignment(current_setting('pin_test.ana_session'),current_setting('pin_test.beto')::uuid);
    raise exception 'Guest read another adult result';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_guest_save_wishes(current_setting('pin_test.ana_session'),current_setting('pin_test.beto')::uuid,array['Unauthorized','',''],'');
    raise exception 'Guest changed another adult preferences';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_create_event('Unauthorized','2026-12-24','Libre','', '[{"name":"X"},{"name":"Y"}]'::jsonb);
    raise exception 'Anonymous guest created an event';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_delete_event(current_setting('pin_test.event')::uuid,'ELIMINAR');
    raise exception 'Anonymous guest deleted an event';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_delete_account('BORRAR CUENTA');
    raise exception 'Anonymous guest deleted an organizer account';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from intercambio_private.pin_credentials;
    raise exception 'Guest read PIN hashes';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from intercambio_private.organizer_access;
    raise exception 'Guest read organizer access configuration';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from intercambio_private.guest_sessions;
    raise exception 'Guest read bearer-session hashes';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from intercambio_private.assignments;
    raise exception 'Guest read the assignments table';
  exception when insufficient_privilege then null; end;
  begin
    perform intercambio_private.issue_guest_session(current_setting('pin_test.beto')::uuid);
    raise exception 'Guest issued a session without a PIN';
  exception when insufficient_privilege then null; end;
  begin
    perform * from intercambio_private.guest_context(current_setting('pin_test.ana_session'));
    raise exception 'Internal session resolver was exposed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin
  if (select count(*)::text from auth.users)<>current_setting('pin_test.user_count') then raise exception 'Guest access created Supabase accounts'; end if;
  if not exists(select 1 from intercambio_private.pin_credentials where participant_id=current_setting('pin_test.ana')::uuid
    and pin_hash like '$2a$10$%' and length(pin_hash)=60 and pin_hash=extensions.crypt('041029',pin_hash)
    and pin_hash<>extensions.crypt('999999',pin_hash)) then raise exception 'PIN was not protected by salted cost-10 bcrypt'; end if;
  if not exists(select 1 from intercambio_private.guest_sessions where participant_id=current_setting('pin_test.ana')::uuid
    and token_hash=encode(extensions.digest(current_setting('pin_test.ana_session'),'sha256'),'hex')
    and token_hash<>current_setting('pin_test.ana_session')) then raise exception 'Session token was not stored only as a digest'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'intercambio_guest_%' and p.prosecdef) then raise exception 'Public guest API unexpectedly uses SECURITY DEFINER'; end if;
  if (select count(*) from intercambio_private.assignments where event_id=current_setting('pin_test.event')::uuid and revealed_at is not null)<>2 then raise exception 'Result reveal tracking is incorrect'; end if;
  perform set_config('pin_test.assignments',(select jsonb_agg(jsonb_build_array(giver_id,receiver_id) order by giver_id)::text from intercambio_private.assignments where event_id=current_setting('pin_test.event')::uuid),true);
end $$;

set local role anon;
do $$ declare v_response jsonb; v_i integer;
begin
  for v_i in 1..5 loop
    v_response:=public.intercambio_guest_login(current_setting('pin_test.ana_invite'),'999999');
    if (v_response->>'ok')::boolean then raise exception 'Wrong PIN authenticated'; end if;
  end loop;
  if (v_response->>'retry_after_seconds')::integer<>900 then raise exception 'Fifth failure did not set the lockout'; end if;
  v_response:=public.intercambio_guest_login(current_setting('pin_test.ana_invite'),'041029');
  if (v_response->>'ok')::boolean or (v_response->>'retry_after_seconds')::integer<890 then raise exception 'Correct PIN bypassed active lockout'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from intercambio_private.pin_credentials where participant_id=current_setting('pin_test.ana')::uuid and failed_attempts=5 and locked_until>clock_timestamp()+interval '14 minutes') then raise exception 'Failed attempts did not persist'; end if;
  update intercambio_private.pin_credentials set locked_until=clock_timestamp()-interval '1 second' where participant_id=current_setting('pin_test.ana')::uuid;
end $$;
set local role anon;
do $$ declare v_response jsonb;
begin
  v_response:=public.intercambio_guest_login(current_setting('pin_test.ana_invite'),'041029');
  if not (v_response->>'ok')::boolean then raise exception 'Correct leading-zero PIN failed after lockout expiry'; end if;
  perform set_config('pin_test.ana_second_session',v_response->>'session_token',true);
end $$;
reset role;
do $$ begin
  if not exists(select 1 from intercambio_private.pin_credentials where participant_id=current_setting('pin_test.ana')::uuid and failed_attempts=0 and locked_until is null) then raise exception 'Successful login did not clear failed attempts'; end if;
  update intercambio_private.guest_sessions set expires_at=clock_timestamp()-interval '1 second'
    where token_hash=encode(extensions.digest(current_setting('pin_test.ana_second_session'),'sha256'),'hex');
end $$;
set local role anon;
do $$ declare v_response jsonb;
begin
  begin
    perform public.intercambio_guest_profile(current_setting('pin_test.ana_second_session'));
    raise exception 'Expired session was accepted';
  exception when invalid_authorization_specification then null; end;
  v_response:=public.intercambio_guest_login(current_setting('pin_test.ana_invite'),'041029');
  if not (v_response->>'ok')::boolean then raise exception 'Valid login failed'; end if;
  perform public.intercambio_guest_logout(v_response->>'session_token');
  begin
    perform public.intercambio_guest_profile(v_response->>'session_token');
    raise exception 'Logged-out session was accepted';
  exception when invalid_authorization_specification then null; end;
  v_response:=public.intercambio_guest_register(current_setting('pin_test.beto_invite'),'222222');
  if not (v_response->>'ok')::boolean then raise exception 'Account-linked participant could not register a PIN'; end if;
  perform set_config('pin_test.beto_session',v_response->>'session_token',true);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','ca6ba7f9-77c8-4795-9d00-fb493fa29bbb',true);
select set_config('request.jwt.claims','{"sub":"ca6ba7f9-77c8-4795-9d00-fb493fa29bbb","role":"authenticated"}',true);
do $$ declare v_invites jsonb;
begin
  v_invites:=public.intercambio_get_participant_invites(current_setting('pin_test.event')::uuid);
  if not exists(select 1 from jsonb_array_elements(v_invites) x where x->>'name'='Ana' and (x->>'has_pin')::boolean
    and x->>'token'=current_setting('pin_test.ana_invite')) then raise exception 'Organizer cannot resend a PIN-protected invitation'; end if;
  perform public.intercambio_reset_pin(current_setting('pin_test.ana')::uuid);
end $$;
reset role;
do $$ begin
  if exists(select 1 from intercambio_private.pin_credentials where participant_id=current_setting('pin_test.ana')::uuid) then raise exception 'Reset retained the previous PIN'; end if;
  if exists(select 1 from intercambio_private.guest_sessions where participant_id=current_setting('pin_test.ana')::uuid) then raise exception 'Reset retained an old session'; end if;
  if (select wishes[1] from public.intercambio_participants where id=current_setting('pin_test.ana')::uuid)<>'Libro'
    or (select extra from public.intercambio_participants where id=current_setting('pin_test.child')::uuid)<>'Talla 8' then raise exception 'Reset erased preferences'; end if;
  if (select jsonb_agg(jsonb_build_array(giver_id,receiver_id) order by giver_id)::text from intercambio_private.assignments where event_id=current_setting('pin_test.event')::uuid)<>current_setting('pin_test.assignments') then raise exception 'Reset changed the draw'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ declare v_response jsonb;
begin
  begin
    perform public.intercambio_guest_profile(current_setting('pin_test.ana_session'));
    raise exception 'Reset did not revoke an earlier session';
  exception when invalid_authorization_specification then null; end;
  perform public.intercambio_guest_profile(current_setting('pin_test.beto_session'));
  v_response:=public.intercambio_guest_register(current_setting('pin_test.ana_invite'),'333333');
  if not (v_response->>'ok')::boolean then raise exception 'Reset did not permit choosing a new PIN'; end if;
  perform public.intercambio_guest_profile(v_response->>'session_token');
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','ca6ba7f9-77c8-4795-9d00-fb493fa29bbb',true);
select set_config('request.jwt.claims','{"sub":"ca6ba7f9-77c8-4795-9d00-fb493fa29bbb","role":"authenticated"}',true);
do $$ begin
  perform public.intercambio_archive_event(current_setting('pin_test.event')::uuid);
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$ begin
  begin
    perform public.intercambio_guest_profile(current_setting('pin_test.beto_session'));
    raise exception 'Archived event session remained accessible';
  exception when invalid_authorization_specification then null; end;
  begin
    perform public.intercambio_guest_preview(current_setting('pin_test.beto_invite'));
    raise exception 'Archived invitation remained available';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','ca6ba7f9-77c8-4795-9d00-fb493fa29bbb',true);
select set_config('request.jwt.claims','{"sub":"ca6ba7f9-77c8-4795-9d00-fb493fa29bbb","role":"authenticated"}',true);
do $$ begin
  begin
    perform public.intercambio_delete_event(current_setting('pin_test.event')::uuid,'eliminar');
    raise exception 'Wrong event-deletion confirmation was accepted';
  exception when invalid_parameter_value then null; end;
  if not exists(select 1 from public.intercambio_events where id=current_setting('pin_test.event')::uuid) then
    raise exception 'Wrong confirmation changed the event';
  end if;
  perform public.intercambio_delete_event(current_setting('pin_test.event')::uuid,'ELIMINAR');
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.intercambio_events where id=current_setting('pin_test.event')::uuid)
    or exists(select 1 from public.intercambio_participants where event_id=current_setting('pin_test.event')::uuid)
    or exists(select 1 from intercambio_private.assignments where event_id=current_setting('pin_test.event')::uuid)
    or exists(select 1 from intercambio_private.participant_invites where event_id=current_setting('pin_test.event')::uuid)
    or exists(select 1 from intercambio_private.pin_credentials where participant_id=current_setting('pin_test.beto')::uuid)
    or exists(select 1 from intercambio_private.guest_sessions where participant_id=current_setting('pin_test.beto')::uuid) then
    raise exception 'Event deletion did not cascade over its own data';
  end if;
  if not exists(select 1 from public.intercambio_events where id=current_setting('pin_test.other_event')::uuid)
    or (select count(*) from public.intercambio_participants where event_id=current_setting('pin_test.other_event')::uuid)<>2 then
    raise exception 'Deleting one event changed another event';
  end if;
end $$;
-- Account removal affects Intercambio data/access, not the shared auth identity.
do $$ declare v_other_owner uuid; v_stocka_count text;
begin
  insert into public.intercambio_events(owner_id,title,event_date,budget)
  values('20000000-0000-4000-8000-000000000001','__PIN_OTHER_OWNER__','2026-12-24','Libre')
  returning id into v_other_owner;
  perform set_config('pin_test.other_owner_event',v_other_owner::text,true);
  if to_regclass('public.profiles') is not null then
    execute 'select count(*)::text from public.profiles where id=$1'
      into v_stocka_count using 'ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'::uuid;
    perform set_config('pin_test.stocka_profile_count',v_stocka_count,true);
  end if;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.intercambio_delete_account('BORRAR');
    raise exception 'Wrong account-deletion confirmation was accepted';
  exception when invalid_parameter_value then null; end;
  if not public.intercambio_is_organizer()
    or not exists(select 1 from public.intercambio_events where id=current_setting('pin_test.other_event')::uuid) then
    raise exception 'Wrong confirmation changed the organizer account';
  end if;
  perform public.intercambio_delete_account('BORRAR CUENTA');
  if public.intercambio_is_organizer() then raise exception 'Removed account retained organizer access'; end if;
  begin
    perform public.intercambio_create_event('After removal','2026-12-24','Libre','', '[{"name":"X"},{"name":"Y"}]'::jsonb);
    raise exception 'Removed organizer created another event';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare v_stocka_count text;
begin
  if not exists(select 1 from auth.users where id='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'
    and email=current_setting('pin_test.organizer_email') and email_confirmed_at is not null) then
    raise exception 'Intercambio removal changed the shared authentication identity';
  end if;
  if exists(select 1 from intercambio_private.organizer_access where user_id='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb')
    or exists(select 1 from public.intercambio_events where owner_id='ca6ba7f9-77c8-4795-9d00-fb493fa29bbb') then
    raise exception 'Intercambio account removal retained its access or events';
  end if;
  if not exists(select 1 from public.intercambio_events where id=current_setting('pin_test.other_owner_event')::uuid) then
    raise exception 'Account removal deleted another owner event';
  end if;
  if to_regclass('public.profiles') is not null then
    execute 'select count(*)::text from public.profiles where id=$1'
      into v_stocka_count using 'ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'::uuid;
    if v_stocka_count<>current_setting('pin_test.stocka_profile_count') then raise exception 'Account removal affected Stocka profiles'; end if;
  end if;
end $$;
rollback;
select 'PASS: PIN, bcrypt, privacy, lockout, sessions, dependents, reset, event/account removal and rollback' as verification;
