import { DatabaseSync } from 'node:sqlite'

/**
 * One connection per thread; SQLite's own file locking coordinates them. WAL
 * lets readers proceed during a write; busy_timeout turns a write conflict into
 * a wait. synchronous=NORMAL survives an application crash, not power loss.
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}
