import {PGlite} from '@electric-sql/pglite'
import {readFile,readdir} from 'node:fs/promises'
const db=new PGlite()
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
  `)
  for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'))
  }
  await db.exec(await readFile(new URL('../tests/db/backend.sql',import.meta.url),'utf8'))
  const {rows}=await db.query('select count(*)::int as users from auth.users')
  if(rows[0].users!==0)throw new Error('Test fixtures were not rolled back')
  console.log('PASS: database permissions, private results, invitations, dependents, draw invariants, redraw and rollback.')
} finally { await db.close() }
