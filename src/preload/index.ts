import { contextBridge } from 'electron'

// The bridge surface grows with the IPC contract; nothing to expose yet.
contextBridge.exposeInMainWorld('api', {})
