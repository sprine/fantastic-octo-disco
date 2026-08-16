import { BrowserWindow, dialog, shell } from 'electron'
import { existsSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import type { DatabaseSync } from 'node:sqlite'
import { getImageRow, type Queries } from './db/queries.js'
import { withTransaction } from './db/withTransaction.js'
import { errorMessage } from '../shared/errors.js'
import { LIBRARY_PAGE_SIZE, type DeleteMode, type DriftState, type ImageRow } from '../shared/types.js'

/** The page size is policy, so it lives here rather than in an IPC handler. */
export const listLibrary = (q: Queries): ImageRow[] =>
  q.listReady.all(LIBRARY_PAGE_SIZE) as ImageRow[]

/**
 * Lazy drift detection: one stat, mark, keep the row. A missing file is never
 * grounds for deleting the user's record of it — an unplugged drive is
 * indistinguishable from a deletion.
 *
 * A recently checked row skips the whole check (holding the arrow key runs
 * this once per keypress); when a check does happen it is recorded, so
 * checked_at keeps its meaning.
 */
const DRIFT_RECHECK_MS = 30_000

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

/** Both shell actions answer a vanished row the same way: one wording, one place. */
function requireImageRow(q: Queries, id: number): ImageRow {
  const row = getImageRow(q, id)
  if (!row) throw new Error('This image is no longer in the library')
  return row
}

/**
 * The only route to a TIF at full fidelity, so it is not a convenience — and
 * a failure here must be loud. shell.openPath reports problems as a returned
 * string, which an earlier version discarded: a moved file read as a button
 * that does nothing.
 */
export async function openOriginal(q: Queries, id: number): Promise<void> {
  const row = requireImageRow(q, id)
  const problem = await shell.openPath(row.source_path)
  if (problem) throw new Error(problem)
}

/**
 * Reveal in Finder / Explorer. showItemInFolder is fire-and-forget and does
 * nothing quietly for a path that is gone, so the existence check is what
 * turns a moved file into an answer instead of a dead menu item.
 */
export function showInFolder(q: Queries, id: number): void {
  const row = requireImageRow(q, id)
  if (!existsSync(row.source_path)) throw new Error(`No file at ${row.source_path}`)
  shell.showItemInFolder(row.source_path)
}

/** Enough paths to recognise what is about to be trashed; past that, a count. */
const CONFIRM_DETAIL_PATHS = 8

/**
 * Two distinct operations behind one parameter. 'library' never touches the
 * files. 'original' trashes each one first, so a failure there keeps that row
 * and the user keeps a record of what they still have.
 *
 * The confirmation lives here rather than on a button: it guards the one
 * irreversible action in the application, and a guarantee that holds for a
 * single call site is not a guarantee. One dialog per batch, never per file.
 *
 * Resolves to how many rows were removed — 0 tells the caller the dialog was
 * cancelled. A file that would not trash is skipped, logged, and reported at
 * the end so one stubborn path does not strand the rest of the batch.
 */
export async function removeImages(
  db: DatabaseSync,
  q: Queries,
  invalidate: (id: number) => void,
  ids: number[],
  mode: DeleteMode,
  now = Date.now()
): Promise<number> {
  const rows = ids.map((id) => getImageRow(q, id)).filter((row): row is ImageRow => row !== null)
  if (rows.length === 0) return 0

  if (mode === 'original') {
    const paths = rows.map((row) => row.source_path)
    const shown = paths.slice(0, CONFIRM_DETAIL_PATHS)
    if (paths.length > shown.length) shown.push(`…and ${paths.length - shown.length} more`)
    // Parented, or on Windows/Linux the confirmation is a separate top-level
    // window that can fall behind the app with the caller's promise pending.
    const parent = BrowserWindow.getAllWindows()[0]
    const options = {
      type: 'warning' as const,
      buttons: ['Cancel', 'Move to trash'],
      defaultId: 0,
      cancelId: 0,
      message:
        rows.length === 1 ? 'Move this file to the trash?' : `Move these ${rows.length} files to the trash?`,
      detail: shown.join('\n')
    }
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    if (response !== 1) return 0
  }

  const failed: string[] = []
  let removed = 0
  try {
    for (const row of rows) {
      if (mode === 'original') {
        try {
          await shell.trashItem(row.source_path)
        } catch (error) {
          q.logDeletion.run(row.id, row.source_path, mode, now, errorMessage(error))
          failed.push(`${row.source_path}: ${errorMessage(error)}`)
          continue
        }
      }

      await Promise.all(
        [row.thumb_path, row.display_path].map((derivative) =>
          derivative ? rm(derivative, { force: true }) : undefined
        )
      )

      withTransaction(db, () => {
        q.deleteImage.run(row.id) // cascades to ingestion_log
        q.logDeletion.run(row.id, row.source_path, mode, now, null)
      })
      removed += 1
    }
  } finally {
    // Deletion carries its own protocol-cache coherence (invariant 1): a future
    // caller that is not the IPC handler must not be able to strand 404s. Even
    // on a partial failure — some rows may already be gone.
    for (const id of ids) invalidate(id)
  }

  if (failed.length > 0) {
    throw new Error(`could not trash ${failed.length} of ${rows.length}:\n${failed.join('\n')}`)
  }
  return removed
}
