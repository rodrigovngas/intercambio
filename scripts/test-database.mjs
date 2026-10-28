import { readFile } from 'node:fs/promises'
import { createTestDatabase, migrationFiles, applyMigration, seedOrganizer, runPinSqlSuite } from './test-pin-database.mjs'

const db = await createTestDatabase()
try {
  const files = await migrationFiles()
  const baseIndex = files.findIndex((file) => file.endsWith('_intercambio_backend.sql'))
  if (baseIndex < 0) throw new Error('The original backend migration is missing')
  for (const file of files.slice(0, baseIndex + 1)) await applyMigration(db, file)
  await db.exec(await readFile(new URL('../tests/db/backend.sql', import.meta.url), 'utf8'))
  const { rows } = await db.query('select count(*)::int as users from auth.users')
  if (rows[0].users !== 0) throw new Error('Original test fixtures were not rolled back')
  console.log('PASS: original database permissions, invitations, dependents, draw invariants and rollback.')

  await seedOrganizer(db)
  for (const file of files.slice(baseIndex + 1)) await applyMigration(db, file)
  await runPinSqlSuite(db)
  console.log('PASS: real bcrypt, guest privacy, lockout, sessions, dependents, reset and scoped deletions verified.')
} finally {
  await db.close()
}
