import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CHANNELS, type Api } from '../shared/ipc.js'

/** The whole renderer-facing surface. Thin calls only; no logic lives here. */
const api: Api = {
  library: {
    list: () => ipcRenderer.invoke(CHANNELS.libraryList),
    check: (id) => ipcRenderer.invoke(CHANNELS.libraryCheck, id),
    remove: (ids, mode) => ipcRenderer.invoke(CHANNELS.libraryRemove, ids, mode)
  },
  ingest: {
    pickAndAdd: () => ipcRenderer.invoke(CHANNELS.ingestPick),
    addPaths: (paths) => ipcRenderer.invoke(CHANNELS.ingestAddPaths, paths),
    counts: () => ipcRenderer.invoke(CHANNELS.ingestCounts),
    failures: () => ipcRenderer.invoke(CHANNELS.ingestFailures),
    retry: (jobId) => ipcRenderer.invoke(CHANNELS.ingestRetry, jobId),
    dismiss: (jobId) => ipcRenderer.invoke(CHANNELS.ingestDismiss, jobId),
    dismissAll: () => ipcRenderer.invoke(CHANNELS.ingestDismissAll),
    cancelPending: () => ipcRenderer.invoke(CHANNELS.ingestCancelPending),
    onEvent: (listener) => {
      const wrapped = (_event: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
      ipcRenderer.on(CHANNELS.ingestEvent, wrapped)
      return () => ipcRenderer.off(CHANNELS.ingestEvent, wrapped)
    }
  },
  shell: {
    openOriginal: (id) => ipcRenderer.invoke(CHANNELS.shellOpenOriginal, id),
    showInFolder: (id) => ipcRenderer.invoke(CHANNELS.shellShowInFolder, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (patch) => ipcRenderer.invoke(CHANNELS.settingsSet, patch)
  },
  files: {
    pathsFor: (files) => files.map((file) => webUtils.getPathForFile(file))
  }
}

contextBridge.exposeInMainWorld('api', api)
