import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const ORGANIZER_ID = 'ca6ba7f9-77c8-4795-9d00-fb493fa29bbb'
export const ORGANIZER_EMAIL = 'organizer@example.invalid'
const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url)

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

export async function migrationFiles() {
  return (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort()
}

export async function applyMigration(db, file) {
  await db.exec(await readFile(new URL(file, migrationsDirectory), 'utf8'))
}

export async function seedOrganizer(db) {
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()) on conflict(id) do nothing',
    [ORGANIZER_ID, ORGANIZER_EMAIL],
  )
}

export async function createPinTestDatabase() {
  const db = await createTestDatabase()
  try {
    await seedOrganizer(db)
    const files = await migrationFiles()
    const pinIndex = files.findIndex((file) => file.endsWith('_guest_pin_access.sql'))
    if (pinIndex < 0) throw new Error('The guest PIN migration is missing')
    for (const file of files.slice(0, pinIndex + 1)) await applyMigration(db, file)
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}

export async function createMixedTestDatabase() {
  const db = await createPinTestDatabase()
  try {
    const files = await migrationFiles()
    const pinIndex = files.findIndex((file) => file.endsWith('_guest_pin_access.sql'))
    for (const file of files.slice(pinIndex + 1)) await applyMigration(db, file)
    return db
  } catch (error) { await db.close(); throw error }
}

export async function runMixedSqlSuite(db) {
  await db.exec(await readFile(new URL('../tests/db/mixed_access.sql', import.meta.url), 'utf8'))
  const { rows } = await db.query(`
    select (select count(*)::int from auth.users where id <> $1::uuid) as extra_users,
      (select count(*)::int from public.intercambio_events) as events,
      (select count(*)::int from intercambio_private.pin_credentials) as pins,
      (select count(*)::int from intercambio_private.guest_sessions) as sessions,
      (select count(*)::int from intercambio_private.application_accounts where user_id <> $1::uuid) as extra_accounts
  `, [ORGANIZER_ID])
  if (Object.values(rows[0]).some((count) => count !== 0)) throw new Error('Mixed-access test fixtures were not rolled back')
}

export async function runPinSqlSuite(db) {
  await db.exec(await readFile(new URL('../tests/db/pin.sql', import.meta.url), 'utf8'))
  const { rows } = await db.query(`
    select
      (select count(*)::int from auth.users where id <> $1::uuid) as extra_users,
      (select count(*)::int from public.intercambio_events) as events,
      (select count(*)::int from intercambio_private.pin_credentials) as credentials,
      (select count(*)::int from intercambio_private.guest_sessions) as sessions
  `, [ORGANIZER_ID])
  if (Object.values(rows[0]).some((count) => count !== 0)) {
    throw new Error('PIN test fixtures were not rolled back')
  }
  const access = await db.query('select count(*)::int as organizers from intercambio_private.organizer_access where user_id=$1::uuid', [ORGANIZER_ID])
  if (access.rows[0].organizers !== 1) throw new Error('Account-removal test was not rolled back')
}

async function main() {
  const db = await createPinTestDatabase()
  try {
    await runPinSqlSuite(db)
    console.log('PASS: real bcrypt, guest privacy, lockout, sessions, dependents, reset and scoped deletions verified.')
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
