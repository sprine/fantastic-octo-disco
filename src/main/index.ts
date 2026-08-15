import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'

/**
 * One process owns the library: a second instance would share the database file
 * but not the abandon sweep, the protocol cache or the worker budget.
 */
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (!existing) return
    if (existing.isMinimized()) existing.restore()
    existing.focus()
  })
  void start()
}

async function start(): Promise<void> {
  await app.whenReady()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1343,
    height: 893,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) window.loadURL(devUrl)
  else window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))

  return window
}
