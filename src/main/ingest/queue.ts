import { setImmediate } from 'node:timers/promises'
import type { DatabaseSync } from 'node:sqlite'
import { createQueries, type Queries } from '../db/queries.js'
import { withTransaction } from '../db/withTransaction.js'
import { canonicalisePath } from '../canonicalPath.js'
import {
  clearsOnImport,
  FAILURE_PAGE_SIZE,
  type FailureReason,
  type Failures,
  type JobRow,
  type JobState,
  type QueueCounts,
  zeroCounts
} from '../../shared/types.js'

/** A row claimed longer than this is presumed abandoned by a dead worker. */
export const CLAIM_TIMEOUT_MS = 60_000

/** Bounds how many times a file that kills its worker is handed to a fresh one. */
export const MAX_ATTEMPTS = 5

/**
 * Bounded so one import neither holds the write lock for its whole duration
 * nor takes it twenty thousand times. Workers get gaps to claim in either way.
 */
const ENQUEUE_CHUNK = 500

/**
 * The queue is a table, not a memory structure, so a forced quit loses
 * nothing. Every instance takes a connection: main and each worker hold their own.
 */
export class Queue {
  private readonly q: Queries
  private cancelGeneration = 0
  private session: number

  constructor(private readonly db: DatabaseSync, queries?: Queries) {
    this.q = queries ?? createQueries(db)
    // Read back from the table: a launch that resumes an interrupted import
    // must report that import's progress, not open a second run over it.
    this.session = (this.q.maxSession.get() as { session: number | null }).session ?? 0
  }

  /**
   * Canonicalisation belongs here, not in callers: it is what the unique index
   * dedupes on. Returns null when the path is already in the library.
   */
  enqueue(sourcePath: string, now = Date.now()): number | null {
    const session = this.beginSession()
    const canonical = canonicalisePath(sourcePath)
    const id = withTransaction(this.db, () => this.insert(sourcePath, canonical, now, session))
    if (id !== null) this.adopt(session)
    return id
  }

  /**
   * Which run the next arrival of work belongs to: work added while anything is
   * outstanding joins the current run; a fresh run starts only once the queue
   * has drained. Deliberately does not mutate — the number becomes current when
   * a row is actually written, so two drops racing a long walk share one run.
   */
  beginSession(): number {
    return this.q.peekOutstanding.get(this.session) ? this.session : this.session + 1
  }

  /** A session is only real once a row carries it. */
  private adopt(session: number): void {
    if (session > this.session) this.session = session
  }

  /**
   * Read before a walk starts and handed back to enqueueAll: sampled at
   * enqueue time it would miss a cancel issued during enumeration, which for a
   * large drop is where most of the wall clock goes.
   */
  get generation(): number {
    return this.cancelGeneration
  }

  /**
   * The pacing policy for every batch writer, held once: bounded chunks so the
   * write lock is taken neither for a whole import nor twenty thousand times,
   * a yield between chunks so the main thread stays live, and a cancel check
   * per chunk — yielding is what makes a batch interruptible, so a generation
   * sampled before a long walk must be honoured here, not in each copy.
   */
  private async *chunks<T>(
    items: readonly T[],
    generation: number,
    size = ENQUEUE_CHUNK
  ): AsyncGenerator<T[]> {
    for (let start = 0; start < items.length; start += size) {
      if (this.cancelGeneration !== generation) return
      yield items.slice(start, start + size)
      if (start + size < items.length) await setImmediate()
    }
  }

  /**
   * The batch form. Canonicalisation (a realpath per file) happens outside the
   * transaction so the write lock covers only the inserts.
   */
  async enqueueAll(
    sourcePaths: string[],
    opts: { chunkSize?: number; generation?: number; session?: number } = {}
  ): Promise<{ enqueued: number; duplicates: number }> {
    const size = Math.max(1, Math.trunc(opts.chunkSize ?? ENQUEUE_CHUNK)) // non-positive would never advance
    const generation = opts.generation ?? this.cancelGeneration
    // From the caller, so a drop's files and its rejections share one run.
    const session = opts.session ?? this.beginSession()
    let enqueued = 0
    let duplicates = 0

    for await (const slice of this.chunks(sourcePaths, generation, size)) {
      const chunk = slice.map((source) => ({ source, canonical: canonicalisePath(source) }))
      const now = Date.now()

      // Counted inside, applied after the commit: a rolled-back chunk must not
      // leave the totals claiming work that no longer exists.
      const chunkResult = withTransaction(this.db, () => {
        let added = 0
        let seen = 0
        for (const { source, canonical } of chunk) {
          if (this.insert(source, canonical, now, session) === null) seen++
          else added++
        }
        return { added, seen }
      })
      enqueued += chunkResult.added
      duplicates += chunkResult.seen
      if (chunkResult.added > 0) this.adopt(session)
    }
    return { enqueued, duplicates }
  }

  /** Caller owns the transaction, so this never nests one. */
  private insert(
    sourcePath: string,
    canonical: string,
    now: number,
    session: number
  ): number | null {
    const image = this.q.insertPendingImage.get(canonical, sourcePath, now) as
      | { id: number }
      | undefined
    if (!image) return null // already in the library; the unique index said so

    // The file arrived, so any standing rejection for it is now false.
    this.q.clearRejection.run(canonical)
    return (this.q.enqueue.get(image.id, canonical, session, now) as { id: number }).id
  }

  /**
   * Rejections and walk guards: failures with no job behind them. They belong
   * in the table rather than an IPC reply because the failures list promises
   * to survive a reload. A drop can reject up to the walk cap, so this runs on
   * the same chunk scaffold as enqueueAll — canonicalisation (a realpath per
   * entry) outside the transaction, and a cancel mid-batch stops the writes.
   */
  async recordFailures(
    entries: readonly { path: string; reason: FailureReason }[],
    session = this.beginSession(),
    generation = this.cancelGeneration,
    now = Date.now()
  ): Promise<number> {
    if (entries.length === 0) return 0

    // A folder and a file inside it can enumerate one path twice; the refresh
    // collapses them into one row, so the tally must collapse them too.
    const seen = new Set<string>()
    let written = 0
    for await (const slice of this.chunks(entries, generation)) {
      const chunk = slice.map((entry) => ({
        reason: entry.reason,
        // A skipped link is the thing the user must act on; resolving it would
        // store the target and collapse two different links into one complaint.
        canonical: canonicalisePath(entry.path, {
          resolveSymlinks: entry.reason !== 'folder-skipped'
        }),
        kind: clearsOnImport(entry.reason)
      }))

      const count = withTransaction(this.db, () => {
        let wrote = 0
        for (const { reason, canonical, kind } of chunk) {
          // A complaint about the file and one about the drop can both be true
          // of one path, so the key is the pair. Joined on NUL, the one byte a
          // path cannot contain — written as an escape, since the literal byte
          // makes the file binary to grep and to git.
          const key = `${canonical}\0${kind}`
          if (seen.has(key)) continue
          seen.add(key)
          // Already in the library means it did not fail to arrive — but only
          // for file-content complaints. A walk-count row often names a file
          // already imported, and the truncation notice must survive a re-drop.
          if (kind && this.q.imageIdForPath.get(canonical)) continue
          if (!this.q.refreshRejection.get(reason, session, now, now, canonical, Number(kind))) {
            this.q.recordRejection.run(canonical, session, now, now, reason)
          }
          wrote++
        }
        return wrote
      })
      written += count
      if (count > 0) this.adopt(session)
    }
    return written
  }

  /** Cheap and bounded: a tree has far fewer directories than files. */
  clearFolderComplaints(dirs: readonly string[]): void {
    if (dirs.length === 0) return
    withTransaction(this.db, () => {
      for (const dir of dirs) this.q.clearFolderComplaint.run(canonicalisePath(dir))
    })
  }

  /**
   * Gated by a read so an idle worker does not take the write lock several
   * times a second. The gate can go stale between the two statements, which
   * costs nothing: the claim is conditional and simply returns null.
   */
  claim(workerId: string, now = Date.now()): JobRow | null {
    if (!this.q.peekPending.get()) return null
    return (this.q.claim.get(workerId, now) as JobRow | undefined) ?? null
  }

  /** Returns false when the row was reclaimed underneath this worker. */
  complete(jobId: number, workerId: string, now = Date.now()): boolean {
    return Number(this.q.completeJob.run(now, jobId, workerId).changes) > 0
  }

  fail(
    jobId: number,
    imageId: number | null,
    error: string,
    workerId: string,
    now = Date.now()
  ): boolean {
    const owned = Number(this.q.failJob.run(now, error, jobId, workerId).changes) > 0
    // Only the owner may condemn the image: a worker that lost the row must
    // not mark it failed while the winner is still deriving it.
    if (owned && imageId !== null) this.q.markImageFailed.run(imageId)
    return owned
  }

  /** Called while a job runs, so a slow-but-alive decode never looks abandoned. */
  renewClaim(jobId: number, workerId: string, now = Date.now()): void {
    this.q.renewClaim.run(now, jobId, workerId)
  }

  /**
   * Run at launch and periodically. Recovery and giving up belong together: a
   * row released for the sixth time is a file that keeps killing workers.
   */
  releaseAbandoned(now = Date.now(), timeout = CLAIM_TIMEOUT_MS): number {
    this.q.settleFinished.run(now) // work that finished but never closed itself out
    this.q.releaseAbandoned.run(now - timeout)

    const exhausted = this.q.failExhausted.all(
      now,
      `gave up after ${MAX_ATTEMPTS} attempts`,
      MAX_ATTEMPTS
    ) as { image_id: number | null }[]
    for (const row of exhausted) {
      if (row.image_id !== null) this.q.markImageFailed.run(row.image_id)
    }
    return exhausted.length
  }

  /**
   * Both tables move together, or the image reads 'failed' while its job runs.
   * Driven by what the update changed: retrying a job that is not failed must
   * move neither table.
   */
  retry(jobId: number): void {
    const session = this.beginSession()
    const adopted = withTransaction(this.db, () => {
      const retried = this.q.retryJob.get(session, jobId) as { image_id: number } | undefined
      if (!retried) return false
      this.q.resetImageToPending.run(retried.image_id)
      return true
    })
    if (adopted) this.adopt(session)
  }

  /**
   * Both rows go together, or the image is left at 'failed' where nothing
   * lists it and the unique index refuses the file as a duplicate forever.
   * Returns false when there was nothing to dismiss (live work is not dismissible).
   */
  dismiss(jobId: number): boolean {
    return withTransaction(this.db, () => {
      const dismissed = this.q.dismissFailure.get(jobId) as { image_id: number | null } | undefined
      if (!dismissed) return false
      if (dismissed.image_id !== null) this.q.deleteDismissedImage.run(dismissed.image_id)
      return true
    })
  }

  /**
   * The whole list at once. Sixty-six rejections dismissed one at a time is
   * how a safety surface teaches people to ignore it. Returns how many went.
   */
  dismissAll(): number {
    return withTransaction(this.db, () => {
      const before = (this.q.countFailures.get() as { n: number }).n
      this.q.dismissAllFailedImages.run()
      this.q.dismissAllFailures.run()
      return before
    })
  }

  /**
   * Drops what has not started; work in flight survives and is detached so the
   * next drop opens a fresh run instead of inheriting this one's done count.
   */
  cancelPending(): number {
    this.cancelGeneration++ // stops an enqueueAll that is mid-flight
    return withTransaction(this.db, () => {
      // A worker can commit markReady and lose its claim, leaving a pending job
      // behind a ready image that neither half of the cancel below matches.
      this.q.settleFinished.run(Date.now())
      const dropped = Number(this.q.cancelPending.run(this.session).changes)
      this.q.detachCancelledClaims.run(this.session)
      // Retried work moves to its own fresh run, so the strip honestly reads
      // 0/1 rather than inheriting the cancelled import's done rows.
      const next = this.session + 1
      if (Number(this.q.carryRetriedForward.run(next, this.session).changes) > 0) {
        this.adopt(next)
      }
      return dropped
    })
  }

  /** The current run only; failures() is the durable list, this is the progress strip. */
  counts(): QueueCounts {
    const base = zeroCounts()
    for (const row of this.q.counts.all(this.session) as { state: JobState; n: number }[]) {
      base[row.state] = row.n
    }
    return base
  }

  failures(): Failures {
    return {
      items: this.q.listFailures.all(FAILURE_PAGE_SIZE) as JobRow[],
      total: (this.q.countFailures.get() as { n: number }).n
    }
  }
}
