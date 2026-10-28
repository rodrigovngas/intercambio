import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createPinTestDatabase,
  createDatabaseTestSession,
  createTestParticipants,
  ORGANIZER_ID,
  ORGANIZER_EMAIL,
} from '../scripts/test-database-helpers.mjs'

let db
const OUTSIDER_ID = '30000000-0000-4000-8000-000000000001'

const { asRole, queryResult } = createDatabaseTestSession(() => db, { includeClaims: true })
async function createPinFixture() {
  await asRole('authenticated', ORGANIZER_ID)
  const event = await queryResult(
    'select public.intercambio_create_event($1,$2,$3,$4,$5::jsonb) as result',
    ['PIN test', '2026-12-24', 'Libre', '', JSON.stringify(createTestParticipants())],
  )
  const invites = await queryResult(
    'select public.intercambio_get_participant_invites($1) as result',
    [event],
  )
  const ana = invites.find((invite) => invite.name === 'Ana')
  const beto = invites.find((invite) => invite.name === 'Beto')
  await asRole('anon')
  const registered = await queryResult(
    'select public.intercambio_guest_register($1,$2) as result',
    [ana.token, '041029'],
  )
  expect(registered.ok).toBe(true)
  return { event, ana, beto, session: registered.session_token }
}

beforeAll(async () => {
  db = await createPinTestDatabase()
  await db.exec(`create table public.stocka_test_sentinel (
    user_id uuid primary key references auth.users(id) on delete cascade,
    preserved text not null
  )`)
}, 30000)

beforeEach(async () => {
  await asRole('postgres')
  await db.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2', [
    ORGANIZER_EMAIL,
    ORGANIZER_ID,
  ])
  await db.query(
    "insert into intercambio_private.organizer_access(user_id,email_hash) select id,encode(extensions.digest(lower(email),'sha256'),'hex') from auth.users where id=$1 on conflict do nothing",
    [ORGANIZER_ID],
  )
})

afterEach(async () => {
  await asRole('postgres')
  await db.exec('delete from public.intercambio_events; delete from public.stocka_test_sentinel')
  await db.query('delete from auth.users where id<>$1', [ORGANIZER_ID])
})
afterAll(async () => {
  await db?.close()
})

describe('guest PIN authentication across independent database requests', () => {
  it('commits failed attempts across requests and enforces the lockout even for a correct PIN', async () => {
    const { ana } = await createPinFixture()
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await queryResult('select public.intercambio_guest_login($1,$2) as result', [
        ana.token,
        '999999',
      ])
      expect(result.ok).toBe(false)
      if (attempt === 4) expect(result.retry_after_seconds).toBe(900)
    }
    const blocked = await queryResult('select public.intercambio_guest_login($1,$2) as result', [
      ana.token,
      '041029',
    ])
    expect(blocked.ok).toBe(false)
    expect(blocked.retry_after_seconds).toBeGreaterThan(880)
    await asRole('postgres')
    const { rows } = await db.query(
      'select failed_attempts,locked_until>now() as locked from intercambio_private.pin_credentials where participant_id=$1',
      [ana.participant_id],
    )
    expect(rows).toEqual([{ failed_attempts: 5, locked: true }])
    expect(await queryResult('select count(*)::int as result from auth.users')).toBe(1)
    await db.query(
      "update intercambio_private.pin_credentials set locked_until=now()-interval '1 second' where participant_id=$1",
      [ana.participant_id],
    )
    await asRole('anon')
    expect(
      (
        await queryResult('select public.intercambio_guest_login($1,$2) as result', [
          ana.token,
          '041029',
        ])
      ).ok,
    ).toBe(true)
  }, 20000)

  it('requires the fixed identity, verified email and application access rather than editable metadata', async () => {
    await asRole('postgres')
    await db.query(
      'insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)',
      [OUTSIDER_ID, ORGANIZER_EMAIL, { email: ORGANIZER_EMAIL }],
    )
    await asRole('authenticated', OUTSIDER_ID)
    expect(await queryResult('select public.intercambio_is_organizer() as result')).toBe(false)
    await expect(
      queryResult('select public.intercambio_create_event($1,$2,$3,$4,$5::jsonb) as result', [
        'No access',
        '2026-12-24',
        'Libre',
        '',
        '[{"name":"A"},{"name":"B"}]',
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await asRole('postgres')
    await db.query('update auth.users set email_confirmed_at=null where id=$1', [ORGANIZER_ID])
    await asRole('authenticated', ORGANIZER_ID)
    expect(await queryResult('select public.intercambio_is_organizer() as result')).toBe(false)
    await asRole('postgres')
    await db.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2', [
      'different@example.invalid',
      ORGANIZER_ID,
    ])
    await asRole('authenticated', ORGANIZER_ID)
    expect(await queryResult('select public.intercambio_is_organizer() as result')).toBe(false)
  })

  it('rejects forged bearer sessions and does not grant internal session-issuing helpers', async () => {
    const { beto } = await createPinFixture()
    await expect(
      queryResult('select public.intercambio_guest_profile($1) as result', ['0'.repeat(64)]),
    ).rejects.toMatchObject({ code: '28000' })
    await expect(
      queryResult('select intercambio_private.issue_guest_session($1) as result', [
        beto.participant_id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      queryResult('select public.intercambio_claim_participant($1) as result', [beto.token]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('stores different salted bcrypt hashes for identical PINs and never stores the raw session token', async () => {
    const { ana, beto, session } = await createPinFixture()
    const registered = await queryResult(
      'select public.intercambio_guest_register($1,$2) as result',
      [beto.token, '041029'],
    )
    expect(registered.ok).toBe(true)
    await asRole('postgres')
    const { rows } = await db.query(
      'select pin_hash,extensions.crypt($1,pin_hash)=pin_hash as valid from intercambio_private.pin_credentials order by participant_id',
      ['041029'],
    )
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.valid && /^\$2a\$10\$/.test(row.pin_hash))).toBe(true)
    expect(rows[0].pin_hash).not.toBe(rows[1].pin_hash)
    const stored = await db.query(
      "select token_hash=encode(extensions.digest($1,'sha256'),'hex') as digest,token_hash<>$1 as not_raw from intercambio_private.guest_sessions where participant_id=$2",
      [session, ana.participant_id],
    )
    expect(stored.rows).toEqual([{ digest: true, not_raw: true }])
  })

  it('requires explicit account-removal text and preserves the shared identity and another app data', async () => {
    const { event } = await createPinFixture()
    await asRole('postgres')
    await db.query('insert into public.stocka_test_sentinel(user_id,preserved) values($1,$2)', [
      ORGANIZER_ID,
      'Keep Stocka data',
    ])
    await asRole('authenticated', ORGANIZER_ID)
    await expect(
      queryResult('select public.intercambio_delete_account($1) as result', ['BORRAR']),
    ).rejects.toMatchObject({ code: '22023' })
    expect(await queryResult('select public.intercambio_is_organizer() as result')).toBe(true)
    expect(
      await queryResult(
        'select count(*)::int as result from public.intercambio_events where id=$1',
        [event],
      ),
    ).toBe(1)
    await queryResult('select public.intercambio_delete_account($1) as result', ['BORRAR CUENTA'])
    expect(await queryResult('select public.intercambio_is_organizer() as result')).toBe(false)
    await asRole('postgres')
    expect(
      await queryResult('select count(*)::int as result from auth.users where id=$1 and email=$2', [
        ORGANIZER_ID,
        ORGANIZER_EMAIL,
      ]),
    ).toBe(1)
    expect(
      await queryResult(
        'select preserved as result from public.stocka_test_sentinel where user_id=$1',
        [ORGANIZER_ID],
      ),
    ).toBe('Keep Stocka data')
    expect(
      await queryResult(
        'select count(*)::int as result from public.intercambio_events where owner_id=$1',
        [ORGANIZER_ID],
      ),
    ).toBe(0)
    expect(
      await queryResult(
        'select count(*)::int as result from intercambio_private.organizer_access where user_id=$1',
        [ORGANIZER_ID],
      ),
    ).toBe(0)
  })
})
