import { readFile } from 'node:fs/promises'
import {
  createTestDatabase,
  loadMigrationStages,
  applyMigrations,
  seedOrganizer,
  runPinSqlSuite,
  runMixedSqlSuite,
  PIN_SUITE_SUCCESS,
} from './test-database-helpers.mjs'

const db = await createTestDatabase()
try {
  const stages = await loadMigrationStages()
  await applyMigrations(db, stages.backend)
  await db.exec(await readFile(new URL('../tests/db/backend.sql', import.meta.url), 'utf8'))
  const { rows } = await db.query('select count(*)::int as users from auth.users')
  if (rows[0].users !== 0) throw new Error('Original test fixtures were not rolled back')
  console.log(
    'PASS: original database permissions, invitations, dependents, draw invariants and rollback.',
  )

  await seedOrganizer(db)
  await applyMigrations(db, stages.pin)
  await runPinSqlSuite(db)
  console.log(PIN_SUITE_SUCCESS)

  await applyMigrations(db, stages.mixed)
  await runMixedSqlSuite(db)
  console.log(
    'PASS: multi-user ownership, private PIN privilege, account invitations and persistent reveals verified.',
  )
} finally {
  await db.close()
}
