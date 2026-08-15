import type { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations.js'
import { userVersion } from './queries.js'
import { withTransaction } from './withTransaction.js'

/** Each step commits together with its version bump. */
export function migrate(db: DatabaseSync, migrations = MIGRATIONS): number {
  for (let version = userVersion(db); version < migrations.length; version++) {
    withTransaction(db, () => {
      db.exec(migrations[version]!)
      db.exec(`PRAGMA user_version = ${version + 1}`) // pragmas cannot be parameterised
    })
  }
  return migrations.length
}
