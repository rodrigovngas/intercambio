-- Account and privileged-NIP integration checks. No fixtures survive ROLLBACK.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,is_anonymous) values
 ('40000000-0000-4000-8000-000000000001','normal-organizer@example.invalid',now(),'{"can_use_pin":true}',false),
 ('40000000-0000-4000-8000-000000000002','invited-account@example.invalid',now(),'{}',false),
 ('40000000-0000-4000-8000-000000000003','other-account@example.invalid',now(),'{}',false),
 ('40000000-0000-4000-8000-000000000004','unverified@example.invalid',null,'{}',false),
 ('40000000-0000-4000-8000-000000000005','anonymous@example.invalid',now(),'{}',true);
do $$ begin
  perform set_config('mixed_test.user_count',(select count(*)::text from auth.users),true);
end $$;

-- Unverified and anonymous Auth identities cannot enroll in Intercambio.
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000004',true);
do $$ begin
  if (public.intercambio_account_status()->>'can_organize')::boolean then raise exception 'Unverified user enrolled'; end if;
end $$;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000005',true);
do $$ begin
  if (public.intercambio_account_status()->>'can_organize')::boolean then raise exception 'Anonymous Auth user enrolled'; end if;
end $$;

-- Every normal verified account can own events, but cannot select NIP access.
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
do $$ declare v_status jsonb; v_event uuid; v_invites jsonb;
begin
  v_status:=public.intercambio_account_status();
  if not (v_status->>'can_organize')::boolean or (v_status->>'can_use_pin')::boolean then raise exception 'Normal account status is wrong'; end if;
  v_event:=public.intercambio_create_event('__MIXED_NORMAL__','2026-12-24','Libre','Libros',
    '[{"name":"Normal A"},{"name":"Normal B"},{"name":"Normal child","is_child":true,"guardian_index":0}]'::jsonb);
  perform set_config('mixed_test.normal_event',v_event::text,true);
  if (select guest_access_mode from public.intercambio_events where id=v_event)<>'account' then raise exception 'Normal event defaulted to PIN'; end if;
  begin
    perform public.intercambio_create_event_with_access('Forbidden PIN','2026-12-24','Libre','',
      '[{"name":"A"},{"name":"B"}]'::jsonb,'pin');
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
  begin
    insert into intercambio_private.organizer_access(user_id,email_hash)
      values('40000000-0000-4000-8000-000000000001',repeat('0',64));
    raise exception 'Editable privilege allowlist';
  exception when insufficient_privilege then null; end;
  v_invites:=public.intercambio_get_participant_invites(v_event);
  perform set_config('mixed_test.normal_a',(select x->>'participant_id' from jsonb_array_elements(v_invites) x where x->>'name'='Normal A'),true);
  perform set_config('mixed_test.normal_b',(select x->>'participant_id' from jsonb_array_elements(v_invites) x where x->>'name'='Normal B'),true);
  perform set_config('mixed_test.normal_token',(select x->>'token' from jsonb_array_elements(v_invites) x where x->>'name'='Normal A'),true);
  perform set_config('mixed_test.normal_other_token',(select x->>'token' from jsonb_array_elements(v_invites) x where x->>'name'='Normal B'),true);
  perform set_config('mixed_test.normal_child',(select id::text from public.intercambio_participants where event_id=v_event and is_child),true);
  perform set_config('mixed_test.normal_draw',public.intercambio_draw_event(v_event)::text,true);
end $$;

-- The configured private allowlist grants the privilege, never user metadata.
select set_config('request.jwt.claim.sub','ca6ba7f9-77c8-4795-9d00-fb493fa29bbb',true);
do $$ declare v_status jsonb; v_pin uuid; v_account uuid; v_invites jsonb;
begin
  v_status:=public.intercambio_account_status();
  if not (v_status->>'can_organize')::boolean or not (v_status->>'can_use_pin')::boolean then raise exception 'Configured PIN privilege was lost'; end if;
  v_pin:=public.intercambio_create_event('__MIXED_PIN__','2026-12-24','Libre','',
    '[{"name":"PIN A"},{"name":"PIN B"},{"name":"PIN child","is_child":true,"guardian_index":0}]'::jsonb);
  if (select guest_access_mode from public.intercambio_events where id=v_pin)<>'pin' then raise exception 'Privileged default lost PIN'; end if;
  v_account:=public.intercambio_create_event_with_access('__MIXED_PRIV_ACCOUNT__','2026-12-24','Libre','',
    '[{"name":"Account A"},{"name":"Account B"}]'::jsonb,'account');
  if (select guest_access_mode from public.intercambio_events where id=v_account)<>'account' then raise exception 'Privileged account option failed'; end if;
  perform set_config('mixed_test.pin_event',v_pin::text,true);
  v_invites:=public.intercambio_get_participant_invites(v_pin);
  perform set_config('mixed_test.pin_a',(select x->>'participant_id' from jsonb_array_elements(v_invites) x where x->>'name'='PIN A'),true);
  perform set_config('mixed_test.pin_b',(select x->>'participant_id' from jsonb_array_elements(v_invites) x where x->>'name'='PIN B'),true);
  perform set_config('mixed_test.pin_token',(select x->>'token' from jsonb_array_elements(v_invites) x where x->>'name'='PIN A'),true);
  perform set_config('mixed_test.pin_draw',public.intercambio_draw_event(v_pin)::text,true);
end $$;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
do $$ begin
  if exists(select 1 from public.intercambio_events where id=current_setting('mixed_test.pin_event')::uuid) then raise exception 'Normal account reads another owner event'; end if;
  begin
    perform public.intercambio_archive_event(current_setting('mixed_test.pin_event')::uuid);
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_reset_pin(current_setting('mixed_test.normal_a')::uuid);
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
end $$;

-- A normal invitation cannot be used with any of the anonymous PIN APIs.
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare v_preview jsonb; v_result jsonb;
begin
  v_preview:=public.intercambio_guest_preview(current_setting('mixed_test.normal_token'));
  if v_preview->>'guest_access_mode'<>'account' or (v_preview->>'claimed')::boolean then raise exception 'Account invitation routing is wrong'; end if;
  if v_preview ?| array['wishes','assignments','target_name','pin_hash','session_token'] then raise exception 'Anonymous preview leaked private information'; end if;
  v_result:=public.intercambio_guest_register(current_setting('mixed_test.normal_token'),'123456');
  if (v_result->>'ok')::boolean then raise exception 'Normal event accepted anonymous PIN registration'; end if;
  v_result:=public.intercambio_guest_login(current_setting('mixed_test.normal_token'),'123456');
  if (v_result->>'ok')::boolean then raise exception 'Normal event accepted anonymous PIN login'; end if;
  begin
    perform public.intercambio_claim_participant(current_setting('mixed_test.normal_token'));
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Even a preexisting/private session cannot bypass an event's account mode.
insert into intercambio_private.pin_credentials(participant_id,pin_hash)
values(current_setting('mixed_test.normal_a')::uuid,extensions.crypt('123456',extensions.gen_salt('bf',10)));
select set_config('mixed_test.forbidden_session',(intercambio_private.issue_guest_session(current_setting('mixed_test.normal_a')::uuid)->>'session_token'),true);
set local role anon;
do $$ begin
  begin
    perform public.intercambio_guest_profile(current_setting('mixed_test.forbidden_session'));
    raise exception 'UNEXPECTED_SUCCESS';
  exception when invalid_authorization_specification then null; end;
end $$;
reset role;
delete from intercambio_private.pin_credentials where participant_id=current_setting('mixed_test.normal_a')::uuid;

-- Privileged invitations use NIP without creating any Auth account.
set local role anon;
do $$ declare v_register jsonb; v_profile jsonb; v_result jsonb;
begin
  if public.intercambio_guest_preview(current_setting('mixed_test.pin_token'))->>'guest_access_mode'<>'pin' then raise exception 'PIN preview mode changed'; end if;
  v_register:=public.intercambio_guest_register(current_setting('mixed_test.pin_token'),'041029');
  if not (v_register->>'ok')::boolean then raise exception 'PIN registration failed'; end if;
  perform set_config('mixed_test.pin_session',v_register->>'session_token',true);
  v_profile:=public.intercambio_guest_profile(v_register->>'session_token');
  if jsonb_array_length(v_profile->'profiles')<>2 then raise exception 'PIN dependent scope is incorrect'; end if;
  if exists(select 1 from jsonb_array_elements(v_profile->'profiles') p where (p->>'revealed')::boolean) then raise exception 'Unseen PIN result was already revealed'; end if;
  v_result:=public.intercambio_guest_restore_assignment(v_register->>'session_token',current_setting('mixed_test.pin_a')::uuid,current_setting('mixed_test.pin_draw')::timestamptz);
  if v_result is not null then raise exception 'Restore exposed an unseen PIN result'; end if;
  perform public.intercambio_guest_assignment(v_register->>'session_token',current_setting('mixed_test.pin_a')::uuid);
  v_profile:=public.intercambio_guest_profile(v_register->>'session_token');
  if not exists(select 1 from jsonb_array_elements(v_profile->'profiles') p where p->>'id'=current_setting('mixed_test.pin_a') and (p->>'revealed')::boolean) then raise exception 'PIN reveal state was not persisted'; end if;
  if public.intercambio_guest_restore_assignment(v_register->>'session_token',current_setting('mixed_test.pin_a')::uuid,current_setting('mixed_test.pin_draw')::timestamptz) is null then raise exception 'Seen PIN result was not restored'; end if;
  begin
    perform public.intercambio_guest_restore_assignment(v_register->>'session_token',current_setting('mixed_test.pin_b')::uuid,current_setting('mixed_test.pin_draw')::timestamptz);
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*)::text from auth.users)<>current_setting('mixed_test.user_count') then raise exception 'PIN access created an Auth user'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','ca6ba7f9-77c8-4795-9d00-fb493fa29bbb',true);
select public.intercambio_draw_event(current_setting('mixed_test.pin_event')::uuid,current_setting('mixed_test.pin_draw')::timestamptz);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare v_profile jsonb;
begin
  if public.intercambio_guest_restore_assignment(current_setting('mixed_test.pin_session'),current_setting('mixed_test.pin_a')::uuid,current_setting('mixed_test.pin_draw')::timestamptz) is not null then raise exception 'Stale PIN restore exposed a new draw'; end if;
  v_profile:=public.intercambio_guest_profile(current_setting('mixed_test.pin_session'));
  if exists(select 1 from jsonb_array_elements(v_profile->'profiles') p where (p->>'revealed')::boolean) then raise exception 'Stale PIN restore marked the new draw'; end if;
  if public.intercambio_guest_restore_assignment(current_setting('mixed_test.pin_session'),current_setting('mixed_test.pin_a')::uuid,(v_profile->'event'->>'drawn_at')::timestamptz) is not null then raise exception 'Unseen redrawn PIN result was restored'; end if;
end $$;

-- Registered invitees can join only account events, never evade NIP in PIN ones.
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
do $$ declare v_state jsonb; v_event uuid;
begin
  perform public.intercambio_account_status();
  if exists(select 1 from public.intercambio_events where id=current_setting('mixed_test.normal_event')::uuid) then raise exception 'Unclaimed account sees an event'; end if;
  perform public.intercambio_claim_participant(current_setting('mixed_test.normal_token'));
  perform public.intercambio_claim_participant(current_setting('mixed_test.normal_token'));
  if (select count(*) from public.intercambio_participants where event_id=current_setting('mixed_test.normal_event')::uuid)<>2 then raise exception 'Account invitee sees other profiles'; end if;
  if not (public.intercambio_guest_preview(current_setting('mixed_test.normal_token'))->>'is_mine')::boolean then raise exception 'Claim retry did not recognize the same account'; end if;
  begin
    perform public.intercambio_claim_participant(current_setting('mixed_test.normal_other_token'));
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_claim_participant(current_setting('mixed_test.pin_token'));
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
  v_state:=public.intercambio_my_profile_state(current_setting('mixed_test.normal_event')::uuid);
  if jsonb_array_length(v_state->'profiles')<>2 then raise exception 'Account reveal state leaked another profile'; end if;
  if exists(select 1 from jsonb_array_elements(v_state->'profiles') p where (p->>'revealed')::boolean) then raise exception 'Account result started revealed'; end if;
  if public.intercambio_restore_my_assignment(current_setting('mixed_test.normal_a')::uuid,current_setting('mixed_test.normal_draw')::timestamptz) is not null then raise exception 'Unseen account result was restored'; end if;
  perform public.intercambio_get_my_assignment(current_setting('mixed_test.normal_a')::uuid);
  v_state:=public.intercambio_my_profile_state(current_setting('mixed_test.normal_event')::uuid);
  if not exists(select 1 from jsonb_array_elements(v_state->'profiles') p where p->>'id'=current_setting('mixed_test.normal_a') and (p->>'revealed')::boolean) then raise exception 'Account reveal did not persist'; end if;
  if public.intercambio_restore_my_assignment(current_setting('mixed_test.normal_a')::uuid,current_setting('mixed_test.normal_draw')::timestamptz) is null then raise exception 'Seen account result did not restore'; end if;
  perform public.intercambio_save_wishes(current_setting('mixed_test.normal_a')::uuid,array['Own private wish','',''],'Private detail');
  perform public.intercambio_save_wishes(current_setting('mixed_test.normal_child')::uuid,array['Child private wish','',''],'Child detail');
  v_event:=public.intercambio_create_event('__MIXED_INVITEE_OWNS__','2026-12-24','Libre','', '[{"name":"Mine A"},{"name":"Mine B"}]'::jsonb);
  perform set_config('mixed_test.invitee_event',v_event::text,true);
end $$;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000003',true);
do $$ begin
  perform public.intercambio_account_status();
  if exists(select 1 from public.intercambio_events where id=current_setting('mixed_test.normal_event')::uuid) then raise exception 'Unrelated registered user sees another event'; end if;
  begin
    perform public.intercambio_claim_participant(current_setting('mixed_test.normal_token'));
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_restore_my_assignment(current_setting('mixed_test.normal_a')::uuid,current_setting('mixed_test.normal_draw')::timestamptz);
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select public.intercambio_draw_event(current_setting('mixed_test.normal_event')::uuid,current_setting('mixed_test.normal_draw')::timestamptz);
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
do $$ declare v_state jsonb;
begin
  if public.intercambio_restore_my_assignment(current_setting('mixed_test.normal_a')::uuid,current_setting('mixed_test.normal_draw')::timestamptz) is not null then raise exception 'Stale account restore exposed the new draw'; end if;
  v_state:=public.intercambio_my_profile_state(current_setting('mixed_test.normal_event')::uuid);
  if exists(select 1 from jsonb_array_elements(v_state->'profiles') p where (p->>'revealed')::boolean) then raise exception 'Restore marked an unseen redrawn account result'; end if;
  perform public.intercambio_get_my_assignment(current_setting('mixed_test.normal_a')::uuid);
end $$;
reset role;
do $$ begin
  perform set_config('mixed_test.draw_pairs',(select jsonb_agg(jsonb_build_array(giver_id,receiver_id) order by giver_id)::text from intercambio_private.assignments where event_id=current_setting('mixed_test.normal_event')::uuid),true);
end $$;

-- Any user can delete only their application data; other owners and Auth survive.
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
select public.intercambio_delete_account('BORRAR CUENTA');
do $$ declare v_status jsonb;
begin
  v_status:=public.intercambio_account_status();
  if not (v_status->>'deleted')::boolean or (v_status->>'can_organize')::boolean then raise exception 'Deleted account was silently re-enrolled'; end if;
  begin
    perform public.intercambio_claim_participant(current_setting('mixed_test.normal_other_token'));
    raise exception 'UNEXPECTED_SUCCESS';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from auth.users where id='40000000-0000-4000-8000-000000000002') then raise exception 'Shared Auth identity was removed'; end if;
  if exists(select 1 from public.intercambio_events where id=current_setting('mixed_test.invitee_event')::uuid) then raise exception 'Deleted account retained its own event'; end if;
  if not exists(select 1 from public.intercambio_events where id=current_setting('mixed_test.normal_event')::uuid) then raise exception 'Account deletion removed another owner event'; end if;
  if exists(select 1 from public.intercambio_participants where event_id=current_setting('mixed_test.normal_event')::uuid and user_id='40000000-0000-4000-8000-000000000002') then raise exception 'Foreign-event profile stayed linked'; end if;
  if exists(select 1 from public.intercambio_participants where id in(current_setting('mixed_test.normal_a')::uuid,current_setting('mixed_test.normal_child')::uuid) and (wishes<>array['','','']::text[] or extra<>'')) then raise exception 'Departed account retained preferences'; end if;
  if exists(select 1 from intercambio_private.participant_invites where token=current_setting('mixed_test.normal_token')) then raise exception 'Departed account retained an invitation'; end if;
  if (select jsonb_agg(jsonb_build_array(giver_id,receiver_id) order by giver_id)::text from intercambio_private.assignments where event_id=current_setting('mixed_test.normal_event')::uuid)<>current_setting('mixed_test.draw_pairs') then raise exception 'Account deletion changed another event draw'; end if;
  if exists(select 1 from intercambio_private.assignments where giver_id=current_setting('mixed_test.normal_a')::uuid and revealed_at is not null) then raise exception 'Departed account reveal marker was retained'; end if;
end $$;
rollback;
select 'PASS: account events, exclusive PIN privilege, scoped invitations, deletion and persistent reveal' as verification;
