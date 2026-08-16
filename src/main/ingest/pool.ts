import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { IngestEvent } from '../../shared/ipc.js'

/**
 * Two workers, not eight: decode is memory-heavy (peak scales with decoded
 * pixels, not file size), so more threads mostly buys thrash.
 */
const DEFAULT_POOL_SIZE = Math.max(1, Math.min(2, availableParallelism() - 1))

const RESPAWN_BACKOFF_MS = 500
/** Long enough that a worker which cannot start costs nothing to keep retrying. */
const MAX_BACKOFF_MS = 30_000

/** Sent by the worker once it reaches the job loop. `started` never reaches the renderer. */
type WorkerMessage = IngestEvent | { type: 'started' }

export class WorkerPool {
  private workers: Worker[] = []

  constructor(
    private readonly dbFile: string,
    private readonly derivativesDir: string,
    private readonly onEvent: (event: IngestEvent) => void,
    private readonly size = DEFAULT_POOL_SIZE,
    /** Overridden only by tests that need the built thread, not the source. */
    private readonly entry = new URL('./worker.js', import.meta.url)
  ) {}

  private stopping = false
  /** Consecutive deaths before reaching the job loop, per slot. */
  private readonly crashes = new Map<number, number>()

  start(): void {
    if (this.workers.length) return
    this.stopping = false
    for (let i = 0; i < this.size; i++) this.spawn(i)
  }

  /**
   * A worker that dies is replaced: decoding is native work, so a malformed
   * file can abort the thread rather than throw where the job loop could
   * isolate it. Without replacement two such files empty the pool and every
   * later import sits at 'pending' with nothing listed as failed.
   */
  private spawn(i: number): void {
    let reachedJobLoop = false
    const worker = new Worker(this.entry, {
      // Paths handed over rather than derived: they come from `app`, a
      // main-thread object. The id is scoped to the launch, not the thread
      // index: a crashed instance's `w0` and the relaunch's `w0` must differ
      // for claimed_by to answer its one question.
      workerData: {
        dbFile: this.dbFile,
        derivativesDir: this.derivativesDir,
        workerId: `${process.pid}-w${i}`
      }
    })
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'started') {
        reachedJobLoop = true
        this.crashes.set(i, 0)
        return
      }
      this.onEvent(message)
    })
    worker.on('error', (error) => console.error('[pool] worker died', error))
    worker.on('exit', () => {
      this.workers = this.workers.filter((live) => live !== worker)
      if (this.stopping) return

      // A worker killed by its file comes straight back — the queue's attempt
      // counter gives up on the file. Only one that never reached the loop is
      // backed off: a sharp binding that will not load won't fix itself by
      // hammering retries. The slot is never abandoned outright.
      const crashes = reachedJobLoop ? 0 : (this.crashes.get(i) ?? 0) + 1
      this.crashes.set(i, crashes)
      if (crashes > 0) {
        console.error(`[pool] worker ${i} died before starting (${crashes} in a row)`)
      }
      const backoff = Math.min(crashes * RESPAWN_BACKOFF_MS, MAX_BACKOFF_MS)
      // The row it held is recovered by the abandon sweep, not here.
      setTimeout(() => this.stopping || this.spawn(i), backoff).unref()
    })
    this.workers.push(worker)
  }

  /**
   * Ask, then insist. Terminating immediately would kill a worker mid-job and
   * strand its row until the abandon timeout; the grace covers a full decode
   * plus two encodes.
   */
  async stop(graceMs = 20_000): Promise<void> {
    this.stopping = true
    const workers = this.workers
    this.workers = []
    await Promise.all(
      workers.map(
        (worker) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(() => void worker.terminate().then(() => resolve()), graceMs)
            worker.once('exit', () => {
              clearTimeout(timer)
              resolve()
            })
            worker.postMessage({ type: 'stop' })
          })
      )
    )
  }
}
