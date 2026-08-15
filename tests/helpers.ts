import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach } from 'vitest'
import { migrate } from '../src/main/db/migrate.js'
import { openDatabase } from '../src/main/db/open.js'

/** One temp directory per test, removed after. */
export function tempDir(prefix: string): { readonly path: string } {
  let path!: string

  beforeEach(() => {
    // realpath'ed because macOS's tmpdir sits behind /var → /private/var, and
    // canonical-path comparisons in tests must not trip over that symlink.
    path = realpathSync(mkdtempSync(join(tmpdir(), `ild-${prefix}-`)))
  })
  afterEach(() => {
    rmSync(path, { recursive: true, force: true })
  })

  return {
    get path() {
      return path
    }
  }
}

export type Fixture = {
  readonly dir: string
  readonly db: DatabaseSync
  readonly file: string
}

/** A temp directory plus a migrated connection in it. */
export function tempDatabase(prefix: string, opts: { migrated?: boolean } = {}): Fixture {
  const dir = tempDir(prefix)
  let db!: DatabaseSync
  let file!: string

  beforeEach(() => {
    file = join(dir.path, 'test.db')
    db = openDatabase(file)
    if (opts.migrated ?? true) migrate(db)
  })

  // Closes before tempDir's afterEach removes the directory: vitest runs them
  // in reverse registration order, so a held handle cannot block removal.
  afterEach(() => db.close())

  return {
    get dir() {
      return dir.path
    },
    get db() {
      return db
    },
    get file() {
      return file
    }
  }
}
