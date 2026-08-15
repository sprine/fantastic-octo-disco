import { dialog, ipcMain } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { CHANNELS } from '../shared/ipc.js'
import type { UiSettings } from '../shared/settings.js'
import { SUPPORTED_EXTENSIONS, type DeleteMode, type EnqueueResult } from '../shared/types.js'
import type { Queries } from './db/queries.js'
import { addPaths } from './ingest/addPaths.js'
import type { Queue } from './ingest/queue.js'
import { checkDrift, listLibrary, openOriginal, removeImage, showInFolder } from './library.js'
import type { SettingsStore } from './settings.js'

export type Context = {
  db: DatabaseSync
  q: Queries
  queue: Queue
  settings: SettingsStore
  invalidate: (id: number) => void
}

/** One handler per channel in the shared contract. No SQL, no policy: both live deeper. */
export function registerIpc({ db, q, queue, settings, invalidate }: Context): void {
  ipcMain.handle(CHANNELS.libraryList, () => listLibrary(q))

  ipcMain.handle(CHANNELS.libraryCheck, (_event, id: number) => checkDrift(q, id))

  ipcMain.handle(CHANNELS.libraryRemove, async (_event, id: number, mode: DeleteMode) => {
    await removeImage(db, q, id, mode)
    invalidate(id)
  })

  ipcMain.handle(CHANNELS.ingestPick, async (): Promise<EnqueueResult | null> => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      // Derived, so the picker and the walker cannot disagree about support.
      filters: [{ name: 'Images', extensions: SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1)) }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    return addPaths(queue, picked.filePaths)
  })

  ipcMain.handle(CHANNELS.ingestAddPaths, (_event, paths: string[]) => addPaths(queue, paths))

  ipcMain.handle(CHANNELS.ingestCounts, () => queue.counts())
  ipcMain.handle(CHANNELS.ingestFailures, () => queue.failures())
  ipcMain.handle(CHANNELS.ingestRetry, (_event, jobId: number) => queue.retry(jobId))
  ipcMain.handle(CHANNELS.ingestDismiss, (_event, jobId: number) => void queue.dismiss(jobId))
  ipcMain.handle(CHANNELS.ingestDismissAll, () => queue.dismissAll())
  ipcMain.handle(CHANNELS.ingestCancelPending, () => queue.cancelPending())

  ipcMain.handle(CHANNELS.shellOpenOriginal, (_event, id: number) => openOriginal(q, id))
  ipcMain.handle(CHANNELS.shellShowInFolder, (_event, id: number) => showInFolder(q, id))

  ipcMain.handle(CHANNELS.settingsGet, () => settings.read())
  // Returns nothing: the renderer already holds the value it asked for, and
  // handing back the sanitised one invites a render that fights the user's drag.
  ipcMain.handle(CHANNELS.settingsSet, (_event, patch: Partial<UiSettings>) => {
    settings.write(patch)
  })
}
