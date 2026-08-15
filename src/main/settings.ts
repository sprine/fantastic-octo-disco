import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { sanitiseSettings, type UiSettings } from '../shared/settings.js'

/**
 * A JSON file beside data/, not a row inside it: data/ is a rebuildable cache
 * and the interface should not reset because someone cleared a thumbnail
 * directory — and a divider drag has no business queueing behind a TIF decode
 * for the database's write lock.
 */
export type SettingsStore = {
  read(): UiSettings
  write(patch: Partial<UiSettings>): UiSettings
}

export function openSettings(file: string): SettingsStore {
  let current: UiSettings | null = null

  const read = (): UiSettings => {
    if (current) return current
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // Absent on first launch, unreadable if a crash caught a write: both
      // mean nothing usable has been stored yet.
      parsed = null
    }
    current = sanitiseSettings(parsed)
    return current
  }

  return {
    read,
    write(patch) {
      // Sanitised on the way in as well as out: the renderer is the one caller
      // and also the least trusted code in the application.
      const next = sanitiseSettings({ ...read(), ...patch })
      const scratch = `${file}.tmp`
      const handle = openSync(scratch, 'w')
      try {
        writeFileSync(handle, JSON.stringify(next))
        // Without this the rename can reach the disk before the bytes do,
        // turning a power cut into a zero-length settings file.
        fsyncSync(handle)
      } finally {
        closeSync(handle)
      }
      renameSync(scratch, file)
      current = next
      return next
    }
  }
}
