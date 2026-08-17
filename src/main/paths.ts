import { app } from 'electron'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** data/ holds only what the application owns: derivatives and the index. */
export const dataDir = (): string => join(app.getPath('userData'), 'data')
export const dbFile = (): string => join(dataDir(), 'metadata.db')
export const thumbnailsDir = (): string => join(dataDir(), 'thumbnails')

/** Beside data/ rather than inside it: interface state is not library data. */
export const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

/**
 * Resolved from out/main/, so the same relative hop works in dev, preview and
 * any future package that ships resources/ alongside out/.
 */
export const appIconFile = (): string =>
  fileURLToPath(new URL('../../resources/icon.png', import.meta.url))

export function ensureDataDirs(): void {
  const dir = thumbnailsDir()
  mkdirSync(dir, { recursive: true })

  // Derivatives are written to scratch names and renamed, so a hard kill mid
  // decode leaves one behind. Launch is the one moment no worker holds one.
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith('.tmp')) rmSync(join(dir, entry), { force: true })
  }
}
