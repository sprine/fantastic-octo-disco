import type { EnqueueResult, FailureReason, GuardReason } from '../../shared/types.js'
import { enumerateImages, type GuardHit, type WalkLimits } from './enumerate.js'
import type { Queue } from './queue.js'

/** The walk's vocabulary is about the walk; the queue's is about what failed. */
const GUARD_REASON: Record<GuardHit['kind'], GuardReason> = {
  depth: 'walk-depth',
  count: 'walk-count'
}

/**
 * The whole "add these paths" operation, reachable without an IPC handler so a
 * future watch-folder or CLI import does not reimplement the tally.
 */
export async function addPaths(
  queue: Queue,
  paths: string[],
  // The production limits are constants; threadable so tests can trip the
  // guards through this function rather than staging the failure row by hand.
  limits?: WalkLimits
): Promise<EnqueueResult> {
  // Captured before the walk (seconds, for a large drop): a cancel in that
  // window must not be forgotten by the time enqueueing begins.
  const generation = queue.generation
  const found = await enumerateImages(paths, limits)

  // Sampled after it: a run that drained during the walk must not adopt this
  // drop along with all of its done rows.
  const session = queue.beginSession()
  const { enqueued, duplicates } = await queue.enqueueAll(
    found.files.map((file) => file.path),
    { generation, session }
  )

  const failures: { path: string; reason: FailureReason }[] = [...found.rejected]
  if (found.guardHit) {
    failures.push({ path: found.guardHit.path, reason: GUARD_REASON[found.guardHit.kind] })
  }

  // Cancel means drop what has not started, complaints included.
  const cancelled = queue.generation !== generation
  if (!cancelled) queue.clearFolderComplaints(found.scanned)
  // The generation rides along: a cancel landing between chunks must stop the
  // remaining complaints too, not just the ones this guard caught.
  const rejected = cancelled ? 0 : await queue.recordFailures(failures, session, generation)

  return { enqueued, duplicates, rejected }
}
