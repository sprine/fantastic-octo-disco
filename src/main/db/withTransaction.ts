import type { DatabaseSync } from 'node:sqlite'

/**
 * IMMEDIATE takes the write lock up front rather than on first write, so a
 * concurrent writer waits out busy_timeout instead of failing partway through.
 */
export function withTransaction<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = body()
    db.exec('COMMIT')
    return result
  } catch (error) {
    // SQLite may already have unwound the transaction (SQLITE_FULL, failed
    // BEGIN); a throwing ROLLBACK must not replace the error that matters.
    try {
      db.exec('ROLLBACK')
    } catch {
      /* already unwound */
    }
    throw error
  }
}
