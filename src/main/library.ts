import { BrowserWindow, dialog, shell } from 'electron'
import { rm, stat } from 'node:fs/promises'
import type { DatabaseSync } from 'node:sqlite'
import { getImageRow, type Queries } from './db/queries.js'
import { withTransaction } from './db/withTransaction.js'
import { errorMessage } from '../shared/errors.js'
import { LIBRARY_PAGE_SIZE, type DeleteMode, type DriftState, type ImageRow } from '../shared/types.js'

/** The page size is policy, so it lives here rather than in an IPC handler. */
export const listLibrary = (q: Queries): ImageRow[] =>
  q.listReady.all(LIBRARY_PAGE_SIZE, 0) as ImageRow[]

/**
 * Lazy drift detection: one stat, mark, keep the row. A missing file is never
 * grounds for deleting the user's record of it — an unplugged drive is
 * indistinguishable from a deletion.
 *
 * A recently checked row skips the whole check (holding the arrow key runs
 * this once per keypress); when a check does happen it is recorded, so
 * checked_at keeps its meaning.
 */
export const DRIFT_RECHECK_MS = 30_000

export async function checkDrift(q: Queries, id: number, now = Date.now()): Promise<ImageRow | null> {
  const row = getImageRow(q, id)
  if (!row) return null
  if (row.checked_at !== null && now - row.checked_at < DRIFT_RECHECK_MS) return row

  let drift: DriftState = 'fresh'
  let mtime = row.mtime_ms
  try {
    const info = await stat(row.source_path)
    mtime = Math.round(info.mtimeMs)
    if (row.mtime_ms !== null && mtime !== row.mtime_ms) drift = 'modified'
  } catch {
    drift = 'missing'
  }

  q.markDrift.run(drift, now, mtime, id)
  return { ...row, drift, mtime_ms: mtime, checked_at: now }
}

/**
 * The only route to a TIF at full fidelity, so it is not a convenience — and
 * a failure here must be loud. shell.openPath reports problems as a returned
 * string, which an earlier version discarded: a moved file read as a button
 * that does nothing.
 */
export async function openOriginal(q: Queries, id: number): Promise<void> {
  const row = getImageRow(q, id)
  if (!row) throw new Error('This image is no longer in the library')
  const problem = await shell.openPath(row.source_path)
  if (problem) throw new Error(problem)
}

/**
 * Two distinct operations behind one parameter. 'library' never touches the
 * file. 'original' trashes it first, so a failure there aborts before the row
 * is dropped and the user keeps a record of what they still have.
 *
 * The confirmation lives here rather than on a button: it guards the one
 * irreversible action in the application, and a guarantee that holds for a
 * single call site is not a guarantee.
 */
export async function removeImage(
  db: DatabaseSync,
  q: Queries,
  id: number,
  mode: DeleteMode,
  now = Date.now()
): Promise<void> {
  const row = getImageRow(q, id)
  if (!row) return

  if (mode === 'original') {
    // Parented, or on Windows/Linux the confirmation is a separate top-level
    // window that can fall behind the app with the caller's promise pending.
    const parent = BrowserWindow.getAllWindows()[0]
    const options = {
      type: 'warning' as const,
      buttons: ['Cancel', 'Move to trash'],
      defaultId: 0,
      cancelId: 0,
      message: 'Move this file to the trash?',
      detail: row.source_path
    }
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    if (response !== 1) return

    try {
      await shell.trashItem(row.source_path)
    } catch (error) {
      q.logDeletion.run(id, row.source_path, mode, now, errorMessage(error))
      throw error
    }
  }

  for (const derivative of [row.thumb_path, row.display_path]) {
    if (derivative) await rm(derivative, { force: true })
  }

  withTransaction(db, () => {
    q.deleteImage.run(id) // cascades to ingestion_log
    q.logDeletion.run(id, row.source_path, mode, now, null)
  })
}
