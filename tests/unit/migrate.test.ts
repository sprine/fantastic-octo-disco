import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/migrate.js'
import { userVersion } from '../../src/main/db/queries.js'
import { MIGRATIONS } from '../../src/main/db/migrations.js'
import { tempDatabase } from '../helpers.js'

const fixture = tempDatabase('migrate', { migrated: false })

describe('migrate', () => {
  it('creates every table on a fresh database', () => {
    migrate(fixture.db)
    const tables = (
      fixture.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
        name: string
      }[]
    ).map((row) => row.name)
    expect(tables).toEqual(expect.arrayContaining(['images', 'ingestion_log', 'deletions_log']))
  })

  it('advances user_version exactly once per migration', () => {
    expect(userVersion(fixture.db)).toBe(0)
    migrate(fixture.db)
    expect(userVersion(fixture.db)).toBe(MIGRATIONS.length)
  })

  it('is idempotent', () => {
    migrate(fixture.db)
    expect(() => migrate(fixture.db)).not.toThrow()
    expect(userVersion(fixture.db)).toBe(MIGRATIONS.length)
  })

  it('applies only the outstanding migrations', () => {
    migrate(fixture.db, MIGRATIONS)
    migrate(fixture.db, [...MIGRATIONS, 'CREATE TABLE later (id INTEGER PRIMARY KEY)'])
    expect(userVersion(fixture.db)).toBe(MIGRATIONS.length + 1)
    expect(fixture.db.prepare(`SELECT name FROM sqlite_master WHERE name='later'`).get()).toBeTruthy()
  })

  it('rolls back a failing migration without advancing the version', () => {
    migrate(fixture.db)
    const before = userVersion(fixture.db)
    expect(() => migrate(fixture.db, [...MIGRATIONS, 'CREATE TABLE broken (', 'SELECT 1'])).toThrow()
    expect(userVersion(fixture.db)).toBe(before)
    expect(
      fixture.db.prepare(`SELECT name FROM sqlite_master WHERE name='broken'`).get()
    ).toBeUndefined()
  })

  it('enables WAL, which is what lets readers proceed during a write', () => {
    expect(
      (fixture.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode
    ).toBe('wal')
  })

  // The DELETE that clears a stale rejection runs on every successful insert,
  // against a table that is the library's whole import history.
  it('indexes the column the rejection sweep looks up', () => {
    migrate(fixture.db)
    const plan = fixture.db
      .prepare(`EXPLAIN QUERY PLAN DELETE FROM ingestion_log
                 WHERE canonical_path = ? AND image_id IS NULL`)
      .all() as { detail: string }[]
    expect(plan.map((step) => step.detail).join(' ')).not.toMatch(/SCAN/)
  })

  // Asserted against the query that draws the library, not the index in
  // isolation: an index that leads with the wrong column leaves SQLite sorting
  // every list call in a temp B-tree.
  it('serves the library listing without sorting it by hand', () => {
    migrate(fixture.db)
    const plan = fixture.db
      .prepare(`EXPLAIN QUERY PLAN
                SELECT * FROM images WHERE status = 'ready'
                 ORDER BY captured_at DESC, id DESC LIMIT 500 OFFSET 0`)
      .all() as { detail: string }[]
    const detail = plan.map((step) => step.detail).join(' ')

    expect(detail).toMatch(/images_ready_order/)
    expect(detail).not.toMatch(/TEMP B-TREE/)
  })
})
