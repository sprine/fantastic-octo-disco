import { app, net, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { canonicalisePath } from './canonicalPath.js'
import { userVersion, type Queries } from './db/queries.js'
import type { Queue } from './ingest/queue.js'
import { errorMessage } from '../shared/errors.js'
import type { ImageRow } from '../shared/types.js'
import { dataDir } from './paths.js'
import { imgUrl } from '../shared/imgUrl.js'

/**
 * Boot verification, not behaviour testing. Runs inside the real application
 * to exercise the wiring units cannot reach: schema, protocol allowlist, and
 * a worker actually claiming from the queue with sharp loaded under Electron.
 * Prints one line the test harness parses.
 */
export async function runSmoke(ctx: {
  db: DatabaseSync
  q: Queries
  queue: Queue
  window: BrowserWindow
}): Promise<void> {
  const checks: Record<string, unknown> = {}
  try {
    checks.windowOpen = !ctx.window.isDestroyed()
    checks.bridgeExposed = await ctx.window.webContents.executeJavaScript(
      'typeof window.api === "object" && typeof window.api.library.list === "function"'
    )
    // The bridge existing does not prove React mounted.
    checks.frameRendered = await ctx.window.webContents.executeJavaScript(
      '!!document.querySelector(".app .viewer")'
    )
    checks.emptyStateShown = await ctx.window.webContents.executeJavaScript(
      '!!document.querySelector(".empty .keymap")'
    )

    // The settings channel end to end: renderer, preload, handler, file.
    checks.settingsRoundTrip = await ctx.window.webContents.executeJavaScript(
      `window.api.settings.set({ columns: 4 }).then(() => window.api.settings.get())`
    )

    const tables = ctx.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
    checks.tables = tables.map((t) => t.name).filter((n) => !n.startsWith('sqlite_'))
    checks.userVersion = userVersion(ctx.db)
    checks.journalMode = (ctx.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string })
      .journal_mode

    // The allowlist must deny by default.
    checks.unknownIdStatus = (await net.fetch(imgUrl(999999, 'thumb'))).status
    checks.malformedStatus = (await net.fetch('img://image/nope/thumb')).status

    // A seeded derivative must be served.
    const derivative = join(dataDir(), 'thumbnails', 'smoke.bin')
    await writeFile(derivative, 'smoke-derivative')
    const seeded = ctx.db
      .prepare(
        `INSERT INTO images (canonical_path, source_path, status, imported_at, thumb_path)
         VALUES (?, ?, 'ready', ?, ?) RETURNING id`
      )
      .get(canonicalisePath(derivative), derivative, Date.now(), derivative) as { id: number }
    const served = await net.fetch(imgUrl(seeded.id, 'thumb'))
    checks.seededStatus = served.status
    checks.seededBody = await served.text()

    // A worker must claim from the queue, decode the file and flip the row to
    // ready — the only check that exercises sharp inside a worker thread under
    // Electron rather than plain node.
    const source = join(dataDir(), 'thumbnails', 'smoke-source.png')
    await sharp({ create: { width: 24, height: 16, channels: 3, background: '#4477aa' } })
      .png()
      .toFile(source)
    ctx.queue.enqueue(source)

    const find = () =>
      ctx.db
        .prepare('SELECT id, status, thumb_path, display_path FROM images WHERE source_path = ?')
        .get(source) as Pick<ImageRow, 'id' | 'status' | 'thumb_path' | 'display_path'> | undefined
    checks.workerProcessed = await waitFor(() => find()?.status === 'ready')

    // The crash-ordering promise in one assertion: a ready row's derivatives
    // are already there.
    const derived = find()
    checks.workerDerivatives = [derived?.thumb_path, derived?.display_path].every(
      (path) => typeof path === 'string' && existsSync(path)
    )

    // End to end: a derivative the worker produced, served through img://.
    if (derived) {
      const response = await net.fetch(imgUrl(derived.id, 'thumb'))
      checks.derivedStatus = response.status
      checks.derivedType = response.headers.get('content-type')
    }
  } catch (error) {
    checks.error = errorMessage(error)
  }

  console.log(`SMOKE_RESULT ${JSON.stringify(checks)}`)
  app.exit(checks.error ? 1 : 0)
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
