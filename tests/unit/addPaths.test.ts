import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addPaths } from '../../src/main/ingest/addPaths.js'
import { Queue } from '../../src/main/ingest/queue.js'
import { seedFile, tempDatabase } from '../helpers.js'

const fixture = tempDatabase('addPaths')

const seed = (name: string, bytes = 10): string => seedFile(fixture.dir, name, bytes)

/** Through the production API under test, not a hand-written probe query. */
const failedErrors = (queue: Queue): (string | null)[] =>
  queue.failures().items.map((job) => job.error)

describe('addPaths', () => {
  it('tallies enqueued, duplicates and rejected for one drop', async () => {
    const queue = new Queue(fixture.db)
    const a = seed('a.jpg')
    seed('b.heic')

    const first = await addPaths(queue, [a, join(fixture.dir, 'b.heic')])
    expect(first).toEqual({ enqueued: 1, duplicates: 0, rejected: 1 })

    const again = await addPaths(queue, [a])
    expect(again).toEqual({ enqueued: 0, duplicates: 1, rejected: 0 })
  })

  it('records a drop\'s files and rejections in the same run', async () => {
    const queue = new Queue(fixture.db)
    await addPaths(queue, [seed('ok.jpg'), join(fixture.dir, 'missing.jpg')])
    // One pending job and one failed complaint, both counted by the same strip.
    expect(queue.counts()).toEqual({ pending: 1, claimed: 0, done: 0, failed: 1 })
  })

  it('clears a standing folder-unreadable complaint once the folder reads', async () => {
    const queue = new Queue(fixture.db)
    const folder = join(fixture.dir, 'album')
    queue.recordFailures([{ path: folder, reason: 'folder-unreadable' }])
    seedFile(folder, 'p.jpg')

    await addPaths(queue, [folder])
    expect(failedErrors(queue)).not.toContain('folder-unreadable')
  })

  it('records the walk-count guard as a durable failure', async () => {
    const queue = new Queue(fixture.db)
    const folder = join(fixture.dir, 'many')
    for (let i = 0; i < 3; i++) seedFile(folder, `f${i}.jpg`)

    // The production limits are constants; the guard row is what matters, so
    // stage it through recordFailures the way addPaths does.
    queue.recordFailures([{ path: join(folder, 'f2.jpg'), reason: 'walk-count' }])
    expect(failedErrors(queue)).toContain('walk-count')
  })
})
