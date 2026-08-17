import { setTimeout as sleep } from 'node:timers/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { errorMessage } from '../../shared/errors.js'
import { createQueries } from '../db/queries.js'
import { openDatabase } from '../db/open.js'
import { processJob } from './processJob.js'
import { CLAIM_TIMEOUT_MS, Queue } from './queue.js'

/**
 * Thread plumbing only. The job body lives in processJob so tests need no
 * worker. Exported so pool.ts types its workerData literal against this —
 * the same drift-is-a-compile-error rule ipc.ts applies to the other seam.
 */
export type WorkerInit = { dbFile: string; derivativesDir: string; workerId: string }

const IDLE_MS = 250

/** Comfortably inside CLAIM_TIMEOUT_MS, so one missed beat is not a lost claim. */
const HEARTBEAT_MS = Math.floor(CLAIM_TIMEOUT_MS / 3)

const { dbFile, derivativesDir, workerId } = workerData as WorkerInit
const db = openDatabase(dbFile) // this thread's own connection
const q = createQueries(db) // prepared once, reused by every job
const queue = new Queue(db, q)

let running = true
parentPort?.on('message', (message: { type: string }) => {
  if (message.type === 'stop') running = false
})

// Tells the pool this thread reached the job loop, so a later death is a job
// killing a worker rather than a worker that cannot start — the two need
// different respawn policies and elapsed time cannot tell them apart.
parentPort?.postMessage({ type: 'started' })

while (running) {
  let job
  try {
    job = queue.claim(workerId)
  } catch (error) {
    // A busy database is a wait, not a death: keep the worker alive.
    console.error('[worker] claim failed', error)
    await sleep(IDLE_MS)
    continue
  }
  if (!job) {
    await sleep(IDLE_MS)
    continue
  }

  // A large TIF off a slow volume can outlast the abandon timeout, and a live
  // worker must not look dead to the sweep.
  const heartbeat = setInterval(() => {
    try {
      queue.renewClaim(job.id, workerId)
    } catch (error) {
      console.error('[worker] heartbeat failed', job.id, error)
    }
  }, HEARTBEAT_MS)

  try {
    await processJob(q, job, derivativesDir)
  } catch (error) {
    // Isolate the failure: one bad file must not take the worker down, and a
    // database busy past its timeout here must not end the thread either.
    try {
      queue.fail(job.id, job.image_id, errorMessage(error), workerId)
    } catch (bookkeeping) {
      console.error('[worker] could not record failure', job.id, bookkeeping)
    }
    parentPort?.postMessage({ type: 'failed', jobId: job.id, imageId: job.image_id })
    continue
  } finally {
    clearInterval(heartbeat)
  }

  // The image is already committed ready; a busy database here must not undo
  // that. A false return means the sweep reclaimed the row and another worker
  // owns the outcome, so this one must not announce it.
  try {
    if (!queue.complete(job.id, workerId)) continue
  } catch (error) {
    console.error('[worker] could not close out job', job.id, error)
  }
  parentPort?.postMessage({ type: 'done', jobId: job.id, imageId: job.image_id })
}

db.close()

// The message-port listener refs the thread; without this the worker never
// emits 'exit' and every graceful stop falls through to the terminate timeout.
parentPort?.close()
