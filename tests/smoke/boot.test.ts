import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import electronPath from 'electron'
import { MIGRATIONS } from '../../src/main/db/migrations.js'
// Type-only, so importing from main pulls no Electron into the test runtime.
import type { SmokeResult } from '../../src/main/smoke.js'

/**
 * One suite, boot only. It exists to rule out the failure every unit can
 * miss: the application does not start. Interface behaviour does not belong
 * here, or this becomes the slow flaky test that gets skipped.
 */
let result: SmokeResult
let userData: string

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'ild-smoke-'))
  const stdout = await run(String(electronPath), ['.'], {
    ...process.env,
    SMOKE: '1',
    SMOKE_USER_DATA: userData,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
  })
  const line = stdout.split('\n').find((l) => l.startsWith('SMOKE_RESULT '))
  if (!line) throw new Error(`no smoke result in output:\n${stdout}`)
  result = JSON.parse(line.slice('SMOKE_RESULT '.length))
}, 150_000)

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('application boot', () => {
  it('reports no error', () => expect(result.error).toBeUndefined())

  it('opens a window with the preload bridge attached', () => {
    expect(result.windowOpen).toBe(true)
    expect(result.bridgeExposed).toBe(true)
  })

  it('renders the two-pane frame and the empty state', () => {
    expect(result.frameRendered).toBe(true)
    expect(result.emptyStateShown).toBe(true)
  })

  it('creates the schema at the current version, in WAL', () => {
    expect(result.tables).toEqual(
      expect.arrayContaining(['images', 'ingestion_log', 'deletions_log'])
    )
    expect(result.userVersion).toBe(MIGRATIONS.length)
    expect(result.journalMode).toBe('wal')
  })

  it('serves a seeded derivative over img:// and denies anything else', () => {
    expect(result.seededStatus).toBe(200)
    expect(result.seededBody).toBe('smoke-derivative')
    expect(result.unknownIdStatus).toBe(404) // the allowlist denies by default
    expect(result.malformedStatus).toBe(400)
  })

  // Only the field the check wrote: pinning the other defaults here would make
  // a UI-default change break the boot suite with zero wiring change.
  it('stores a setting the renderer sent and reads it back', () => {
    expect(result.settingsRoundTrip?.columns).toBe(4)
  })

  // Also the only place sharp is loaded inside a worker thread under Electron.
  it('runs a worker that claims from the queue and writes derivatives', () => {
    expect(result.workerProcessed).toBe(true)
    expect(result.workerDerivatives).toBe(true)
  })

  it('serves a worker-produced derivative back through img://', () => {
    expect(result.derivedStatus).toBe(200)
    expect(result.derivedType).toBe('image/webp')
  })
})

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, timeout: 75_000 }, (error, stdout, stderr) => {
      // A non-zero exit still carries the result line, which says more than the code.
      if (stdout.includes('SMOKE_RESULT ')) return resolve(stdout)
      reject(error ?? new Error(stderr || 'no output'))
    })
  })
}
