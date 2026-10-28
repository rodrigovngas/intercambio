import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const ORGANIZER_ID = 'ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'
export const ORGANIZER_EMAIL = 'organizer@example.invalid'
export const PIN_SUITE_SUCCESS =
  'PASS: real bcrypt, guest privacy, lockout, sessions, dependents, reset and scoped deletions verified.'
const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url)

export function createTestParticipants() {
  return [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Dani', is_child: true, guardian_index: 0 }]
}

export async function createTestDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users (
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz,
      is_anonymous boolean not null default false,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `)
  return db
}

export async function loadMigrationStages() {
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort()
  const backendIndex = files.findIndex((file) => file.endsWith('_intercambio_backend.sql'))
  if (backendIndex < 0) throw new Error('The original backend migration is missing')
  const pinIndex = files.findIndex((file) => file.endsWith('_guest_pin_access.sql'))
  if (pinIndex < 0) throw new Error('The guest PIN migration is missing')
  return {
    backend: files.slice(0, backendIndex + 1),
    pin: files.slice(backendIndex + 1, pinIndex + 1),
    mixed: files.slice(pinIndex + 1),
  }
}

export async function applyMigrations(db, files) {
  for (const file of files) {
    await db.exec(await readFile(new URL(file, migrationsDirectory), 'utf8'))
  }
}

export async function seedOrganizer(db) {
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()) on conflict(id) do nothing',
    [ORGANIZER_ID, ORGANIZER_EMAIL],
  )
}

async function createMigratedTestDatabase(includeMixedAccess) {
  const db = await createTestDatabase()
  try {
    await seedOrganizer(db)
    const stages = await loadMigrationStages()
    const files = [...stages.backend, ...stages.pin]
    if (includeMixedAccess) files.push(...stages.mixed)
    await applyMigrations(db, files)
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}

export function createPinTestDatabase() {
  return createMigratedTestDatabase(false)
}

export function createMixedTestDatabase() {
  return createMigratedTestDatabase(true)
}

export function createDatabaseTestSession(getDatabase, { includeClaims = false } = {}) {
  return {
    async asRole(name, userId = '') {
      if (!['anon', 'authenticated', 'postgres'].includes(name))
        throw new Error('Unknown test role')
      const db = getDatabase()
      await db.exec('reset role')
      if (name !== 'postgres') await db.exec(`set role ${name}`)
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId])
      if (includeClaims) {
        await db.query("select set_config('request.jwt.claims',$1,false)", [
          JSON.stringify({ sub: userId || undefined, role: name }),
        ])
      }
    },
    async queryResult(sql, values = []) {
      return (await getDatabase().query(sql, values)).rows[0].result
    },
  }
}

async function runSqlSuite(db, file, label, includeApplicationAccounts = false) {
  await db.exec(await readFile(new URL(`../tests/db/${file}`, import.meta.url), 'utf8'))
  const { rows } = await db.query(
    `
    select (select count(*)::int from auth.users where id <> $1::uuid) as extra_users,
      (select count(*)::int from public.intercambio_events) as events,
      (select count(*)::int from intercambio_private.pin_credentials) as pins,
      (select count(*)::int from intercambio_private.guest_sessions) as sessions
      ${includeApplicationAccounts ? ',(select count(*)::int from intercambio_private.application_accounts where user_id <> $1::uuid) as extra_accounts' : ''}
  `,
    [ORGANIZER_ID],
  )
  if (Object.values(rows[0]).some((count) => count !== 0))
    throw new Error(`${label} test fixtures were not rolled back`)
}

export async function runMixedSqlSuite(db) {
  await runSqlSuite(db, 'mixed_access.sql', 'Mixed-access', true)
}

export async function runPinSqlSuite(db) {
  await runSqlSuite(db, 'pin.sql', 'PIN')
  const access = await db.query(
    'select count(*)::int as organizers from intercambio_private.organizer_access where user_id=$1::uuid',
    [ORGANIZER_ID],
  )
  if (access.rows[0].organizers !== 1) throw new Error('Account-removal test was not rolled back')
}

async function main() {
  const db = await createPinTestDatabase()
  try {
    await runPinSqlSuite(db)
    console.log(PIN_SUITE_SUCCESS)
  } finally {
    await db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`PIN database verification failed: ${error.message}`)
    process.exitCode = 1
  })
}
