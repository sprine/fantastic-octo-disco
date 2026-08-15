import type { UiSettings } from './settings.js'
import type { DeleteMode, EnqueueResult, Failures, ImageRow, QueueCounts } from './types.js'

/**
 * The contract both sides import, so preload and main drifting apart is a type
 * error rather than a runtime one. Namespaced from the start: a flat surface
 * becomes a god object by v2.
 */
export type Api = {
  library: {
    list(): Promise<ImageRow[]>
    /** Lazy stat on display; marks drift, never removes the row. */
    check(id: number): Promise<ImageRow | null>
    /** 'original' confirms in main, so the guarantee belongs to the operation. */
    remove(id: number, mode: DeleteMode): Promise<void>
  }
  ingest: {
    /** Native picker accepting files and folders; null if cancelled. */
    pickAndAdd(): Promise<EnqueueResult | null>
    addPaths(paths: string[]): Promise<EnqueueResult>
    counts(): Promise<QueueCounts>
    failures(): Promise<Failures>
    retry(jobId: number): Promise<void>
    /** Drops the failure and its image row, so the file can be imported again. */
    dismiss(jobId: number): Promise<void>
    cancelPending(): Promise<number>
    /** Returns an unsubscribe function. */
    onEvent(listener: (event: { type: 'done' | 'failed'; jobId: number }) => void): () => void
  }
  shell: {
    /** The only route to a TIF at full fidelity. */
    openOriginal(id: number): Promise<void>
  }
  settings: {
    get(): Promise<UiSettings>
    /** A patch, so one control writing its own field cannot blank another's. */
    set(patch: Partial<UiSettings>): Promise<void>
  }
  files: {
    /**
     * File.path was removed in Electron 32; webUtils is the supported route and
     * only works in preload, where the File object still exists.
     */
    pathsFor(files: File[]): string[]
  }
}

export const CHANNELS = {
  libraryList: 'library:list',
  libraryCheck: 'library:check',
  libraryRemove: 'library:remove',
  ingestPick: 'ingest:pick',
  ingestAddPaths: 'ingest:addPaths',
  ingestCounts: 'ingest:counts',
  ingestFailures: 'ingest:failures',
  ingestRetry: 'ingest:retry',
  ingestDismiss: 'ingest:dismiss',
  ingestCancelPending: 'ingest:cancelPending',
  shellOpenOriginal: 'shell:openOriginal',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  /** Push, not invoke: main to renderer. Named here so both sides cannot drift. */
  ingestEvent: 'ingest:event'
} as const
