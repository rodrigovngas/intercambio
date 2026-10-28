-- Transactional integration tests. Run against a disposable/local Supabase DB
-- (or the PGlite harness), as postgres. Every fixture is rolled back.
begin;

insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','intercambio-owner@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','intercambio-guest@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','intercambio-outsider@example.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('intercambio_test.event',public.intercambio_create_event(
  'Navidad de prueba','2026-12-24','Libre','Libros',
  '[{"name":"Ana"},{"name":"Beto"},{"name":"Caro"},{"name":"Dani","is_child":true,"guardian_index":0}]'::jsonb
)::text,true);

do $$
declare v_event uuid := current_setting('intercambio_test.event')::uuid; v_invites jsonb;
begin
  if (select count(*) from public.intercambio_events where id=v_event)<>1 then raise exception 'Owner cannot read own event'; end if;
  if (select count(*) from public.intercambio_participants where event_id=v_event)<>4 then raise exception 'Owner participant read failed'; end if;
  v_invites := public.intercambio_get_participant_invites(v_event);
  if jsonb_array_length(v_invites)<>3 then raise exception 'Dependents must not have their own invite'; end if;
  perform set_config('intercambio_test.token',(select x->>'token' from jsonb_array_elements(v_invites) x where x->>'name'='Ana'),true);
  perform set_config('intercambio_test.ana',(select id::text from public.intercambio_participants where event_id=v_event and name='Ana'),true);
  perform set_config('intercambio_test.child',(select id::text from public.intercambio_participants where event_id=v_event and name='Dani'),true);
  perform set_config('intercambio_test.beto',(select id::text from public.intercambio_participants where event_id=v_event and name='Beto'),true);
  if length(current_setting('intercambio_test.token'))<>64 then raise exception 'Invite must have enough entropy'; end if;
  begin
    perform public.intercambio_get_my_assignment(current_setting('intercambio_test.ana')::uuid);
    raise exception 'Owner read someone else''s secret assignment';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare v_event uuid := current_setting('intercambio_test.event')::uuid; v_preview jsonb;
begin
  if exists(select 1 from public.intercambio_events where id=v_event) then raise exception 'Cross-user event leak'; end if;
  if exists(select 1 from public.intercambio_participants where event_id=v_event) then raise exception 'Cross-user participant leak'; end if;
  begin
    perform public.intercambio_get_participant_invites(v_event);
    raise exception 'Cross-user invitation leak';
  exception when insufficient_privilege then null; end;
  begin
    perform public.intercambio_draw_event(v_event);
    raise exception 'Cross-user draw allowed';
  exception when insufficient_privilege then null; end;
  v_preview:=public.intercambio_preview_invite(current_setting('intercambio_test.token'));
  if v_preview->>'participant_name'<>'Ana' or v_preview ? 'wishes' then raise exception 'Invalid invite preview projection'; end if;
  if public.intercambio_claim_participant(current_setting('intercambio_test.token'))<>current_setting('intercambio_test.ana')::uuid then raise exception 'Claim returned wrong participant'; end if;
  -- Idempotent retry for the same account is safe.
  perform public.intercambio_claim_participant(current_setting('intercambio_test.token'));
  if (select count(*) from public.intercambio_participants where event_id=v_event)<>2 then raise exception 'Guest must see only own and dependent profiles'; end if;
  perform public.intercambio_save_wishes(current_setting('intercambio_test.ana')::uuid,array['Libro','Taza','Calcetas'],'Azul');
  perform public.intercambio_save_wishes(current_setting('intercambio_test.child')::uuid,array['Rompecabezas','',''],'Talla 8');
  begin
    perform public.intercambio_save_wishes(current_setting('intercambio_test.beto')::uuid,array['No','',''],'');
    raise exception 'Cross-user wish edit allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.intercambio_participants(event_id,name) values(v_event,'Direct API bypass');
    raise exception 'Direct mutation bypassed guarded RPC';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$
begin
  begin
    perform public.intercambio_claim_participant(current_setting('intercambio_test.token'));
    raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if sqlerrm='UNEXPECTED_SUCCESS' then raise; end if; end;
  begin
    perform public.intercambio_get_my_assignment(current_setting('intercambio_test.ana')::uuid);
    raise exception 'Cross-user secret read';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('intercambio_test.drawn',public.intercambio_draw_event(current_setting('intercambio_test.event')::uuid)::text,true);
do $$
declare v_event uuid := current_setting('intercambio_test.event')::uuid; v_invites jsonb;
begin
  v_invites:=public.intercambio_get_participant_invites(v_event);
  if not exists(select 1 from jsonb_array_elements(v_invites) x where x->>'name'='Ana' and (x->>'claimed')::boolean and x->>'token' is null) then raise exception 'Claimed invite token still exposed'; end if;
  begin
    perform public.intercambio_draw_event(v_event);
    raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if sqlerrm='UNEXPECTED_SUCCESS' then raise; end if; end;
  begin
    perform public.intercambio_add_participant(v_event,'Late participant');
    raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if sqlerrm='UNEXPECTED_SUCCESS' then raise; end if; end;
  begin
    perform public.intercambio_get_my_assignment(current_setting('intercambio_test.ana')::uuid);
    raise exception 'Owner must not read all results';
  exception when insufficient_privilege then null; end;
  perform public.intercambio_archive_event(v_event);
  if (select status from public.intercambio_events where id=v_event)<>'archived' then raise exception 'Archive failed'; end if;
  perform public.intercambio_archive_event(v_event,false);
  if (select status from public.intercambio_events where id=v_event)<>'drawn' then raise exception 'Restore failed'; end if;
end;
$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare v_result jsonb;
begin
  v_result:=public.intercambio_get_my_assignment(current_setting('intercambio_test.ana')::uuid);
  if v_result->>'target_id'=current_setting('intercambio_test.ana') then raise exception 'Self assignment'; end if;
  if not(v_result ? 'target_name' and v_result ? 'wishes' and v_result ? 'extra') then raise exception 'Assignment projection incomplete'; end if;
  perform public.intercambio_get_my_assignment(current_setting('intercambio_test.child')::uuid);
  begin
    perform 1 from intercambio_private.assignments;
    raise exception 'Secret assignments table exposed';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
do $$
declare v_event uuid:=current_setting('intercambio_test.event')::uuid;
begin
  if (select count(*) from intercambio_private.assignments where event_id=v_event)<>4 then raise exception 'Draw cardinality'; end if;
  if (select count(distinct receiver_id) from intercambio_private.assignments where event_id=v_event)<>4 then raise exception 'Repeated receiver'; end if;
  if exists(select 1 from intercambio_private.assignments where event_id=v_event and giver_id=receiver_id) then raise exception 'Self assignment invariant'; end if;
  if (select count(*) from intercambio_private.assignments where event_id=v_event and revealed_at is not null)<>2 then raise exception 'Reveals must be recorded only when requested'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname='intercambio_events' and n.nspname='public' and c.relrowsecurity) then raise exception 'Missing events RLS'; end if;
  if has_table_privilege('anon','public.intercambio_events','select') then raise exception 'Anonymous table access'; end if;
  if has_function_privilege('anon','public.intercambio_create_event(text,date,text,text,jsonb)','execute') then raise exception 'Anonymous write RPC'; end if;
end;
$$;

-- Authenticate as owner to exercise deliberate redraw; all constraints must hold.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.intercambio_draw_event(current_setting('intercambio_test.event')::uuid,current_setting('intercambio_test.drawn')::timestamptz);
reset role;
do $$
begin
  if exists(select 1 from intercambio_private.assignments where event_id=current_setting('intercambio_test.event')::uuid and revealed_at is not null) then raise exception 'Redraw must reset reveal state'; end if;
end;
$$;

-- Force deferred guardian validation before rolling back the fixture.
set constraints all immediate;
rollback;
