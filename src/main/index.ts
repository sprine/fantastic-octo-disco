import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { openDatabase } from './db/open.js'
import { migrate } from './db/migrate.js'
import { createQueries } from './db/queries.js'
import { CLAIM_TIMEOUT_MS, Queue } from './ingest/queue.js'
import { CHANNELS } from '../shared/ipc.js'
import { WorkerPool } from './ingest/pool.js'
import { registerIpc } from './ipc.js'
import { dbFile, ensureDataDirs, settingsFile, thumbnailsDir } from './paths.js'
import { registerImgProtocol, registerImgScheme } from './protocol.js'
import { openSettings } from './settings.js'

// Must happen before ready: userData cannot move once paths have been read.
if (process.env.SMOKE_USER_DATA) app.setPath('userData', process.env.SMOKE_USER_DATA)

/**
 * One process owns the library. A second instance shares the database file but
 * not the abandon sweep, the cancel generation, the protocol cache or the
 * worker budget — each per-process state the two would silently fight over.
 * The lock keys on userData, so smoke runs with their own temp directory
 * still each get one.
 */
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (!existing) return
    if (existing.isMinimized()) existing.restore()
    existing.focus()
  })
  registerImgScheme() // scheme privileges are fixed at app ready
  void start()
}

let pool: WorkerPool | null = null

async function start(): Promise<void> {
  await app.whenReady()
  ensureDataDirs()
  const db = openDatabase(dbFile())
  migrate(db)

  const q = createQueries(db)
  const queue = new Queue(db, q)
  // Unconditionally, not by age: rows in flight during a crash are 'claimed',
  // and the single-instance lock means nothing else can be holding one now.
  queue.releaseAbandoned(Date.now(), 0)

  const { invalidate } = registerImgProtocol(q)
  registerIpc({ db, q, queue, settings: openSettings(settingsFile()), invalidate })

  const window = createWindow()
  // Reads the live window rather than capturing this one: `activate` can build
  // a replacement, and a captured const would pin the destroyed original.
  pool = new WorkerPool(dbFile(), thumbnailsDir(), (event) => {
    if (event.imageId !== null) invalidate(event.imageId) // derivatives may have changed
    BrowserWindow.getAllWindows()[0]?.webContents.send(CHANNELS.ingestEvent, event)
  })
  pool.start()

  // Once at launch is not enough: a worker can die mid-session too. Giving up
  // happens here, not in a worker, and in the terminal case no worker is
  // emitting anything — precisely when the footer must stop claiming work is
  // still pending.
  const sweep = setInterval(() => {
    if (queue.releaseAbandoned() > 0) {
      BrowserWindow.getAllWindows()[0]?.webContents.send(CHANNELS.ingestEvent, {
        type: 'failed',
        jobId: -1,
        imageId: null
      })
    }
  }, CLAIM_TIMEOUT_MS)
  app.once('before-quit', () => clearInterval(sweep))

  if (process.env.SMOKE === '1') {
    const { runSmoke } = await import('./smoke.js')
    await runSmoke({ db, q, queue, window })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Electron does not await an async listener, so the pool's grace period
  // would be abandoned and the workers killed by process exit. Holding the
  // quit once, then quitting for real, is what honours it.
  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    void (async () => {
      await pool?.stop()
      db.close()
      app.quit()
    })()
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
