import { app, net, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { canonicalisePath } from './canonicalPath.js'
import { getImageRow, userVersion, type Queries } from './db/queries.js'
import type { Queue } from './ingest/queue.js'
import { errorMessage } from '../shared/errors.js'
import type { ImageRow } from '../shared/types.js'
import { thumbnailsDir } from './paths.js'
import { imgUrl } from '../shared/imgUrl.js'

/**
 * One shape for both sides of the seam: boot.test.ts imports this type, so a
 * check added, renamed or retyped on one side is a compile error on the other.
 */
export type SmokeResult = {
  windowOpen?: boolean
  bridgeExposed?: boolean
  frameRendered?: boolean
  emptyStateShown?: boolean
  settingsRoundTrip?: { columns: number; drawerOpen: boolean }
  tables?: string[]
  userVersion?: number
  journalMode?: string
  unknownIdStatus?: number
  malformedStatus?: number
  seededStatus?: number
  seededBody?: string
  workerProcessed?: boolean
  workerDerivatives?: boolean
  derivedStatus?: number
  derivedType?: string | null
  error?: string
}

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
  const checks: SmokeResult = {}
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

    // A seeded derivative must be served. Seeded through the prepared queries,
    // not fresh SQL — the same rule the reads below follow. The positionals are
    // untyped, so this tracks markReady's SET list by position: bytes, width,
    // height, format, captured_at, mtime_ms, thumb_path, display_path,
    // metadata_json, checked_at, id.
    const derivative = join(thumbnailsDir(), 'smoke.bin')
    await writeFile(derivative, 'smoke-derivative')
    const seeded = ctx.q.insertPendingImage.get(
      canonicalisePath(derivative),
      derivative,
      Date.now()
    ) as { id: number }
    ctx.q.markReady.run(null, null, null, null, null, null, derivative, null, null, null, seeded.id)
    const served = await net.fetch(imgUrl(seeded.id, 'thumb'))
    checks.seededStatus = served.status
    checks.seededBody = await served.text()

    // A worker must claim from the queue, decode the file and flip the row to
    // ready — the only check that exercises sharp inside a worker thread under
    // Electron rather than plain node.
    const source = join(thumbnailsDir(), 'smoke-source.png')
    await sharp({ create: { width: 24, height: 16, channels: 3, background: '#4477aa' } })
      .png()
      .toFile(source)
    ctx.queue.enqueue(source)

    // Through the prepared queries, not fresh SQL: a column rename must break
    // here at compile time rather than at boot, in the one file whose job is to
    // prove the wiring holds.
    const canonicalSource = canonicalisePath(source)
    const find = (): ImageRow | null => {
      const row = ctx.q.imageIdForPath.get(canonicalSource) as { id: number } | undefined
      return row ? getImageRow(ctx.q, row.id) : null
    }
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
    await sleep(100)
  }
  return false
}
