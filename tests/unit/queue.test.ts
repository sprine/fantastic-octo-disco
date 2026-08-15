import { describe, expect, it } from 'vitest'
import { CLAIM_TIMEOUT_MS, MAX_ATTEMPTS, Queue } from '../../src/main/ingest/queue.js'
import { tempDatabase } from '../helpers.js'
import { join } from 'node:path'
import type { JobRow } from '../../src/shared/types.js'

const fixture = tempDatabase('queue')

const path = (name: string) => join(fixture.dir, name)
const jobRows = (): JobRow[] =>
  fixture.db.prepare('SELECT * FROM ingestion_log ORDER BY id').all() as JobRow[]
const imageStatus = (id: number): string | undefined =>
  (fixture.db.prepare('SELECT status FROM images WHERE id = ?').get(id) as { status: string } | undefined)
    ?.status

describe('enqueue', () => {
  it('inserts a pending image and job; a duplicate path is a silent no-op', () => {
    const queue = new Queue(fixture.db)
    expect(queue.enqueue(path('a.jpg'))).not.toBeNull()
    expect(queue.enqueue(path('a.jpg'))).toBeNull()
    expect(jobRows()).toHaveLength(1)
  })

  it('clears a standing rejection when the file finally arrives', () => {
    const queue = new Queue(fixture.db)
    queue.recordFailures([{ path: path('big.jpg'), reason: 'too-large' }])
    expect(queue.failures().total).toBe(1)
    queue.enqueue(path('big.jpg'))
    expect(queue.failures().total).toBe(0)
  })

  it('does not let importing one file clear a truncation notice that names it', () => {
    const queue = new Queue(fixture.db)
    queue.recordFailures([{ path: path('last.jpg'), reason: 'walk-count' }])
    queue.enqueue(path('last.jpg'))
    expect(queue.failures().total).toBe(1)
  })
})

describe('sessions', () => {
  it('scopes counts to the current run, not the whole history', async () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('old.jpg'))
    const job = queue.claim('w1')!
    queue.complete(job.id, 'w1')

    // Queue drained: the next drop opens a fresh run that never sees old done rows.
    await queue.enqueueAll([path('new.jpg')])
    expect(queue.counts()).toEqual({ pending: 1, claimed: 0, done: 0, failed: 0 })
  })

  it('joins the current run while anything in it is outstanding', async () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('first.jpg'))
    await queue.enqueueAll([path('second.jpg')])
    expect(queue.counts()).toEqual({ pending: 2, claimed: 0, done: 0, failed: 0 })
  })

  it('resumes the interrupted run at construction rather than opening a second one', () => {
    const first = new Queue(fixture.db)
    first.enqueue(path('a.jpg'))
    // A new Queue models a relaunch: same table, fresh in-memory state.
    const relaunched = new Queue(fixture.db)
    relaunched.enqueue(path('b.jpg'))
    expect(relaunched.counts()).toEqual({ pending: 2, claimed: 0, done: 0, failed: 0 })
  })
})

describe('claim', () => {
  it('hands out each row exactly once, oldest first', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('a.jpg'), 100)
    queue.enqueue(path('b.jpg'), 200)
    const first = queue.claim('w1')!
    const second = queue.claim('w2')!
    expect(first.canonical_path).toContain('a.jpg')
    expect(second.canonical_path).toContain('b.jpg')
    expect(queue.claim('w1')).toBeNull()
  })

  it('increments attempts on every claim', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('a.jpg'))
    expect(queue.claim('w1')!.attempts).toBe(1)
  })
})

describe('ownership', () => {
  it('lets only the current owner close out a reclaimed job', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('a.jpg'))
    const job = queue.claim('w1', 1000)!

    // The sweep decides w1 is dead; w2 picks the row up.
    queue.releaseAbandoned(1000 + CLAIM_TIMEOUT_MS + 1)
    const reclaimed = queue.claim('w2')!
    expect(reclaimed.id).toBe(job.id)

    expect(queue.complete(job.id, 'w1')).toBe(false) // the loser must not announce
    expect(queue.complete(job.id, 'w2')).toBe(true)
  })

  it('does not let a worker that lost its claim condemn the image', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('a.jpg'))
    const job = queue.claim('w1', 1000)!
    queue.releaseAbandoned(1000 + CLAIM_TIMEOUT_MS + 1)
    queue.claim('w2')

    expect(queue.fail(job.id, job.image_id, 'boom', 'w1')).toBe(false)
    expect(imageStatus(job.image_id!)).toBe('pending')
  })

  it('keeps a renewed claim out of the sweep', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('a.jpg'))
    const job = queue.claim('w1', 1000)!
    queue.renewClaim(job.id, 'w1', 1000 + CLAIM_TIMEOUT_MS)
    queue.releaseAbandoned(1000 + CLAIM_TIMEOUT_MS + 1)
    expect(queue.claim('w2')).toBeNull() // still claimed by the live worker
  })
})

describe('releaseAbandoned', () => {
  it('gives up on a file that keeps killing its worker', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('killer.jpg'))
    let imageId: number | null = null
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const job = queue.claim('w1', 1000)!
      imageId = job.image_id
      queue.releaseAbandoned(1000 + CLAIM_TIMEOUT_MS + 1)
    }
    const [job] = jobRows()
    expect(job!.state).toBe('failed')
    expect(imageStatus(imageId!)).toBe('failed')
    expect(queue.failures().total).toBe(1)
  })

  it('settles a job whose image finished but never closed itself out', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('a.jpg'))
    const job = queue.claim('w1')!
    // markReady committed, then the process died before completeJob.
    fixture.db.prepare(`UPDATE images SET status = 'ready' WHERE id = ?`).run(job.image_id!)
    queue.releaseAbandoned()
    expect(jobRows()[0]!.state).toBe('done')
  })
})

describe('retry and dismiss', () => {
  const failedJob = (queue: Queue): JobRow => {
    queue.enqueue(path('bad.jpg'))
    const job = queue.claim('w1')!
    queue.fail(job.id, job.image_id, 'decode error', 'w1')
    return queue.failures().items[0]!
  }

  it('retry resets attempts and hands job and image back to the workers', () => {
    const queue = new Queue(fixture.db)
    const job = failedJob(queue)
    queue.retry(job.id)
    const row = jobRows()[0]!
    expect(row.state).toBe('pending')
    expect(row.attempts).toBe(0)
    expect(row.retried).toBe(1)
    expect(imageStatus(job.image_id!)).toBe('pending')
    // The retried work is the run the footer counts.
    expect(queue.counts()).toEqual({ pending: 1, claimed: 0, done: 0, failed: 0 })
  })

  it('retry of a rejection (no image) or a live row moves nothing', () => {
    const queue = new Queue(fixture.db)
    queue.recordFailures([{ path: path('r.jpg'), reason: 'too-large' }])
    const rejection = queue.failures().items[0]!
    queue.retry(rejection.id)
    expect(jobRows()[0]!.state).toBe('failed')
  })

  it('dismiss removes the failure and its image so the file can be imported again', () => {
    const queue = new Queue(fixture.db)
    const job = failedJob(queue)
    expect(queue.dismiss(job.id)).toBe(true)
    expect(jobRows()).toHaveLength(0)
    expect(queue.enqueue(path('bad.jpg'))).not.toBeNull() // not a duplicate any more
  })

  it('dismiss all clears every kind of failure and frees the files for re-import', () => {
    const queue = new Queue(fixture.db)
    // A decode failure with an image behind it, and a rejection without one.
    queue.enqueue(path('bad.jpg'))
    const job = queue.claim('w1')!
    queue.fail(job.id, job.image_id, 'decode error', 'w1')
    queue.recordFailures([{ path: path('huge.jpg'), reason: 'too-large' }])
    // Live work must survive the sweep.
    queue.enqueue(path('live.jpg'))

    expect(queue.dismissAll()).toBe(2)
    expect(queue.failures().total).toBe(0)
    expect(queue.counts().pending).toBe(1)
    expect(queue.enqueue(path('bad.jpg'))).not.toBeNull() // not a duplicate any more
  })

  it('dismiss refuses live work', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('a.jpg'))
    expect(queue.dismiss(jobRows()[0]!.id)).toBe(false)
  })
})

describe('cancelPending', () => {
  it('drops what has not started and keeps what has', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('claimed.jpg'))
    queue.enqueue(path('waiting1.jpg'))
    queue.enqueue(path('waiting2.jpg'))
    queue.claim('w1')

    expect(queue.cancelPending()).toBe(2)
    // The claimed row survives, detached from any run; the run itself is over.
    expect(queue.counts()).toEqual({ pending: 0, claimed: 0, done: 0, failed: 0 })
    expect(jobRows()).toHaveLength(1)
    expect(jobRows()[0]!.state).toBe('claimed')
  })

  it('leaves retried work alone: two clicks must not silently delete a file record', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('bad.jpg'))
    const job = queue.claim('w1')!
    queue.fail(job.id, job.image_id, 'boom', 'w1')
    queue.retry(job.id)

    queue.cancelPending()
    expect(jobRows()[0]!.state).toBe('pending') // still queued for the workers
    expect(queue.counts().pending).toBe(1) // and still counted by the strip
  })

  it('interrupts an enqueueAll already in flight', async () => {
    const queue = new Queue(fixture.db)
    const many = Array.from({ length: 10 }, (_, i) => path(`f${i}.jpg`))
    const generation = queue.generation
    queue.cancelPending()
    const { enqueued } = await queue.enqueueAll(many, { generation, chunkSize: 2 })
    expect(enqueued).toBe(0)
  })
})

describe('recordFailures', () => {
  it('collapses the same complaint enumerated twice into one row', () => {
    const queue = new Queue(fixture.db)
    const wrote = queue.recordFailures([
      { path: path('dup.jpg'), reason: 'too-large' },
      { path: path('dup.jpg'), reason: 'too-large' }
    ])
    expect(wrote).toBe(1)
    expect(queue.failures().total).toBe(1)
  })

  it('refreshes a repeated complaint instead of stacking copies', () => {
    const queue = new Queue(fixture.db)
    queue.recordFailures([{ path: path('big.jpg'), reason: 'too-large' }])
    queue.recordFailures([{ path: path('big.jpg'), reason: 'too-large' }])
    expect(queue.failures().total).toBe(1)
  })

  it('does not complain about a file that is already in the library', () => {
    const queue = new Queue(fixture.db)
    queue.enqueue(path('grown.jpg'))
    queue.recordFailures([{ path: path('grown.jpg'), reason: 'too-large' }])
    expect(queue.failures().total).toBe(0)
  })
})
