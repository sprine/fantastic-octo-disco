import { useState } from 'react'
import type { FailureReason, Failures, QueueCounts } from '../../shared/types.js'
import { MAX_IMPORT_BYTES, WALK_MAX_DEPTH, WALK_MAX_FILES } from '../../shared/types.js'
import type { RunAttempt } from '../actions.js'
import { basename, megabytes } from '../format.js'

/** Main emits a code; the wording and the units are decided here. */
const REJECT_COPY: Record<FailureReason, string> = {
  'too-large': `over ${megabytes(MAX_IMPORT_BYTES)}`,
  unreadable: 'unreadable',
  'folder-unreadable': 'folder could not be read',
  'folder-skipped': 'linked folder not followed',
  unsupported: 'not a JPEG, PNG or TIF',
  'walk-depth': `folders nested past ${WALK_MAX_DEPTH} levels were skipped`,
  'walk-count': `import stopped at ${WALK_MAX_FILES.toLocaleString()} files`
}

// hasOwn, not `in`: a worker error of exactly "toString" would otherwise
// match Object.prototype and render a function as a React child.
const isCode = (error: string): error is FailureReason => Object.hasOwn(REJECT_COPY, error)

/** Anything that is not a code came from a worker and is already prose. */
const describe = (error: string | null): string =>
  error === null ? 'failed' : isCode(error) ? REJECT_COPY[error] : error

type Props = {
  counts: QueueCounts
  failures: Failures
  /** The app-level ingest attempt: the drop target in App and the buttons here
      share one notice, so a failed drop reports where a failed click does. */
  failed: string | null
  run: RunAttempt
}

/**
 * The import button becomes the progress strip. Capture-date ordering means
 * new imports scatter into the middle of the library rather than appearing on
 * top, so this is the only place anything visibly happens during an ingest.
 */
export function ImportFooter({ counts, failures, failed, run }: Props) {
  const [showFailures, setShowFailures] = useState(false)
  // Every ingest mutation reports its failure and is followed by a refresh;
  // stating both rules here once means a new button cannot quietly forget them.
  const mutate = (verb: string, command: () => Promise<unknown>) => run(verb, command, true)
  const outstanding = counts.pending + counts.claimed
  // A failure is settled work: leaving it out would stall the bar short of its
  // own total for the rest of the run.
  const settled = counts.done + counts.failed
  const total = outstanding + settled

  return (
    <footer className="import-footer">
      {outstanding > 0 ? (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${(settled / total) * 100}%` }} />
          <span>
            {settled} / {total}
          </span>
          <button className="link" onClick={() => void mutate('cancel', () => window.api.ingest.cancelPending())}>
            cancel
          </button>
        </div>
      ) : (
        <button className="import" onClick={() => void mutate('import', () => window.api.ingest.pickAndAdd())}>
          + Import images
        </button>
      )}

      {failed && <p className="notice">{failed}</p>}

      {/* Every failure comes from ingestion_log: what a walk rejected sits
          beside what a decode lost, and both survive a reload. */}
      {failures.total > 0 && (
        <div className="failures">
          <button className="link" onClick={() => setShowFailures((open) => !open)}>
            {failures.items.length < failures.total
              ? `${failures.items.length} of ${failures.total} failed`
              : `${failures.total} failed`}
          </button>
          <button
            className="link dismiss-all"
            onClick={async () => {
              if (await mutate('dismiss', () => window.api.ingest.dismissAll())) setShowFailures(false)
            }}
          >
            dismiss all
          </button>
          {showFailures && (
            <ul>
              {failures.items.map((job) => (
                <li key={job.id}>
                  <span title={job.canonical_path}>{basename(job.canonical_path)}</span>
                  <em>{describe(job.error)}</em>
                  {/* A rejected file was never enqueued: there is no job to
                      run again, so retry would only fail a second way. */}
                  {job.image_id !== null && (
                    <button className="link" onClick={() => void mutate('retry', () => window.api.ingest.retry(job.id))}>
                      retry
                    </button>
                  )}
                  <button className="link" onClick={() => void mutate('dismiss', () => window.api.ingest.dismiss(job.id))}>
                    dismiss
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </footer>
  )
}
