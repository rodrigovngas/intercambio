import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createMixedTestDatabase,
  createDatabaseTestSession,
  createTestParticipants,
  ORGANIZER_ID,
} from '../scripts/test-database-helpers.mjs'

const NORMAL_ACCOUNT_ID = '50000000-0000-4000-8000-000000000001'
const INVITED_ACCOUNT_ID = '50000000-0000-4000-8000-000000000002'
const OTHER_ACCOUNT_ID = '50000000-0000-4000-8000-000000000003'
let db
const { asRole, queryResult } = createDatabaseTestSession(() => db)
async function activateAccount(user) {
  await asRole('authenticated', user)
  return queryResult('select public.intercambio_account_status() as result')
}
async function createEventFixture(owner, mode) {
  await activateAccount(owner)
  const args = [
    'Mixed access test',
    '2026-12-24',
    'Libre',
    '',
    JSON.stringify(createTestParticipants()),
  ]
  const id = mode
    ? await queryResult(
        'select public.intercambio_create_event_with_access($1,$2,$3,$4,$5::jsonb,$6) as result',
        [...args, mode],
      )
    : await queryResult(
        'select public.intercambio_create_event($1,$2,$3,$4,$5::jsonb) as result',
        args,
      )
  const invites = await queryResult(
    'select public.intercambio_get_participant_invites($1) as result',
    [id],
  )
  const drawn = await queryResult('select public.intercambio_draw_event($1)::text as result', [id])
  return {
    id,
    drawn,
    ana: invites.find((person) => person.name === 'Ana'),
    beto: invites.find((person) => person.name === 'Beto'),
  }
}
beforeEach(async () => {
  db = await createMixedTestDatabase()
  await db.query(
    `insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
    values($1,'normal@example.invalid',now(),'{"can_use_pin":true}'),
    ($2,'guest@example.invalid',now(),'{}'),($3,'other@example.invalid',now(),'{}')`,
    [NORMAL_ACCOUNT_ID, INVITED_ACCOUNT_ID, OTHER_ACCOUNT_ID],
  )
}, 30000)
afterEach(async () => {
  await db?.close()
})

describe('account events and the server-owned optional PIN privilege', () => {
  it('allows all verified accounts to organize only their events while only the private allowlist can choose PIN', async () => {
    const status = await activateAccount(NORMAL_ACCOUNT_ID)
    expect(status).toEqual({ can_organize: true, can_use_pin: false, deleted: false })
    const normal = await createEventFixture(NORMAL_ACCOUNT_ID)
    expect(
      await queryResult(
        'select guest_access_mode as result from public.intercambio_events where id=$1',
        [normal.id],
      ),
    ).toBe('account')
    await expect(createEventFixture(NORMAL_ACCOUNT_ID, 'pin')).rejects.toMatchObject({
      code: '42501',
    })
    const privileged = await createEventFixture(ORGANIZER_ID)
    expect(
      await queryResult(
        'select guest_access_mode as result from public.intercambio_events where id=$1',
        [privileged.id],
      ),
    ).toBe('pin')
    const optional = await createEventFixture(ORGANIZER_ID, 'account')
    expect(
      await queryResult(
        'select guest_access_mode as result from public.intercambio_events where id=$1',
        [optional.id],
      ),
    ).toBe('account')
    await activateAccount(NORMAL_ACCOUNT_ID)
    expect(
      (await db.query('select id from public.intercambio_events where id=$1', [privileged.id]))
        .rows,
    ).toEqual([])
    await expect(
      queryResult('select public.intercambio_archive_event($1) as result', [privileged.id]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      queryResult('select public.intercambio_reset_pin($1) as result', [normal.ana.participant_id]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('requires a verified account to claim ordinary invitations and never lets anonymous NIP access bypass that mode', async () => {
    const normal = await createEventFixture(NORMAL_ACCOUNT_ID)
    await asRole('anon')
    const preview = await queryResult('select public.intercambio_guest_preview($1) as result', [
      normal.ana.token,
    ])
    expect(preview.guest_access_mode).toBe('account')
    expect(
      (
        await queryResult('select public.intercambio_guest_register($1,$2) as result', [
          normal.ana.token,
          '123456',
        ])
      ).ok,
    ).toBe(false)
    await expect(
      queryResult('select public.intercambio_claim_participant($1) as result', [normal.ana.token]),
    ).rejects.toMatchObject({ code: '42501' })
    await activateAccount(INVITED_ACCOUNT_ID)
    expect(
      (await db.query('select id from public.intercambio_events where id=$1', [normal.id])).rows,
    ).toEqual([])
    expect(
      await queryResult('select public.intercambio_claim_participant($1) as result', [
        normal.ana.token,
      ]),
    ).toBe(normal.ana.participant_id)
    expect(
      await queryResult('select public.intercambio_claim_participant($1) as result', [
        normal.ana.token,
      ]),
    ).toBe(normal.ana.participant_id)
    expect(
      (
        await db.query(
          'select name from public.intercambio_participants where event_id=$1 order by name',
          [normal.id],
        )
      ).rows.map((row) => row.name),
    ).toEqual(['Ana', 'Dani'])
    await expect(
      queryResult('select public.intercambio_claim_participant($1) as result', [normal.beto.token]),
    ).rejects.toMatchObject({ code: '42501' })
    await activateAccount(OTHER_ACCOUNT_ID)
    await expect(
      queryResult('select public.intercambio_claim_participant($1) as result', [normal.ana.token]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      queryResult('select public.intercambio_get_my_assignment($1) as result', [
        normal.ana.participant_id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('persists a PIN reveal across logins while restore never marks an unseen result', async () => {
    const pin = await createEventFixture(ORGANIZER_ID)
    await asRole('anon')
    const registered = await queryResult(
      'select public.intercambio_guest_register($1,$2) as result',
      [pin.ana.token, '041029'],
    )
    expect(registered.ok).toBe(true)
    expect(
      await queryResult('select public.intercambio_guest_restore_assignment($1,$2,$3) as result', [
        registered.session_token,
        pin.ana.participant_id,
        pin.drawn,
      ]),
    ).toBeNull()
    const first = await queryResult('select public.intercambio_guest_assignment($1,$2) as result', [
      registered.session_token,
      pin.ana.participant_id,
    ])
    const profile = await queryResult('select public.intercambio_guest_profile($1) as result', [
      registered.session_token,
    ])
    expect(profile.profiles.find((person) => person.id === pin.ana.participant_id).revealed).toBe(
      true,
    )
    await queryResult('select public.intercambio_guest_logout($1) as result', [
      registered.session_token,
    ])
    const returning = await queryResult('select public.intercambio_guest_login($1,$2) as result', [
      pin.ana.token,
      '041029',
    ])
    const restored = await queryResult(
      'select public.intercambio_guest_restore_assignment($1,$2,$3) as result',
      [returning.session_token, pin.ana.participant_id, profile.event.drawn_at],
    )
    expect(restored.target_id).toBe(first.target_id)
    await expect(
      queryResult('select public.intercambio_guest_restore_assignment($1,$2,$3) as result', [
        returning.session_token,
        pin.beto.participant_id,
        pin.drawn,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('does not expose or mark a new draw from an automatic restore based on stale account or PIN state', async () => {
    const normal = await createEventFixture(NORMAL_ACCOUNT_ID)
    await activateAccount(INVITED_ACCOUNT_ID)
    await queryResult('select public.intercambio_claim_participant($1) as result', [
      normal.ana.token,
    ])
    await queryResult('select public.intercambio_get_my_assignment($1) as result', [
      normal.ana.participant_id,
    ])
    let state = await queryResult('select public.intercambio_my_profile_state($1) as result', [
      normal.id,
    ])
    expect(state.profiles.find((person) => person.id === normal.ana.participant_id).revealed).toBe(
      true,
    )
    await activateAccount(NORMAL_ACCOUNT_ID)
    const accountRedraw = await queryResult(
      'select public.intercambio_draw_event($1,$2)::text as result',
      [normal.id, normal.drawn],
    )
    await activateAccount(INVITED_ACCOUNT_ID)
    expect(
      await queryResult('select public.intercambio_restore_my_assignment($1,$2) as result', [
        normal.ana.participant_id,
        normal.drawn,
      ]),
    ).toBeNull()
    expect(
      await queryResult('select public.intercambio_restore_my_assignment($1,$2) as result', [
        normal.ana.participant_id,
        accountRedraw,
      ]),
    ).toBeNull()
    state = await queryResult('select public.intercambio_my_profile_state($1) as result', [
      normal.id,
    ])
    expect(state.profiles.every((person) => !person.revealed)).toBe(true)

    const pin = await createEventFixture(ORGANIZER_ID)
    await asRole('anon')
    const access = await queryResult('select public.intercambio_guest_register($1,$2) as result', [
      pin.ana.token,
      '654321',
    ])
    await queryResult('select public.intercambio_guest_assignment($1,$2) as result', [
      access.session_token,
      pin.ana.participant_id,
    ])
    await activateAccount(ORGANIZER_ID)
    const pinRedraw = await queryResult(
      'select public.intercambio_draw_event($1,$2)::text as result',
      [pin.id, pin.drawn],
    )
    await asRole('anon')
    expect(
      await queryResult('select public.intercambio_guest_restore_assignment($1,$2,$3) as result', [
        access.session_token,
        pin.ana.participant_id,
        pin.drawn,
      ]),
    ).toBeNull()
    expect(
      await queryResult('select public.intercambio_guest_restore_assignment($1,$2,$3) as result', [
        access.session_token,
        pin.ana.participant_id,
        pinRedraw,
      ]),
    ).toBeNull()
    const profile = await queryResult('select public.intercambio_guest_profile($1) as result', [
      access.session_token,
    ])
    expect(profile.profiles.every((person) => !person.revealed)).toBe(true)
  })

  it('deletes only the departed application account data, keeps foreign events/draws and does not silently re-enroll it', async () => {
    const normal = await createEventFixture(NORMAL_ACCOUNT_ID)
    await activateAccount(INVITED_ACCOUNT_ID)
    await queryResult('select public.intercambio_claim_participant($1) as result', [
      normal.ana.token,
    ])
    await queryResult('select public.intercambio_save_wishes($1,$2::text[],$3) as result', [
      normal.ana.participant_id,
      ['Private wish', '', ''],
      'Private info',
    ])
    const own = await createEventFixture(INVITED_ACCOUNT_ID)
    await queryResult('select public.intercambio_delete_account($1) as result', ['BORRAR CUENTA'])
    expect(await queryResult('select public.intercambio_account_status() as result')).toEqual({
      can_organize: false,
      can_use_pin: false,
      deleted: true,
    })
    await expect(
      queryResult('select public.intercambio_claim_participant($1) as result', [normal.beto.token]),
    ).rejects.toMatchObject({ code: '42501' })
    await asRole('postgres')
    expect(
      await queryResult('select count(*)::int as result from auth.users where id=$1', [
        INVITED_ACCOUNT_ID,
      ]),
    ).toBe(1)
    expect(
      await queryResult(
        'select count(*)::int as result from public.intercambio_events where id=$1',
        [own.id],
      ),
    ).toBe(0)
    expect(
      await queryResult(
        'select count(*)::int as result from public.intercambio_events where id=$1',
        [normal.id],
      ),
    ).toBe(1)
    expect(
      await queryResult(
        'select count(*)::int as result from intercambio_private.assignments where event_id=$1',
        [normal.id],
      ),
    ).toBe(3)
    expect(
      await queryResult(
        'select user_id as result from public.intercambio_participants where id=$1',
        [normal.ana.participant_id],
      ),
    ).toBeNull()
    expect(
      await queryResult(
        'select wishes[1] as result from public.intercambio_participants where id=$1',
        [normal.ana.participant_id],
      ),
    ).toBe('')
    expect(
      await queryResult(
        'select count(*)::int as result from intercambio_private.participant_invites where token=$1',
        [normal.ana.token],
      ),
    ).toBe(0)
  })
})
