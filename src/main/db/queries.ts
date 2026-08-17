import type { DatabaseSync } from 'node:sqlite'
import { CLEARS_ON_IMPORT, type ImageRow } from '../../shared/types.js'

/**
 * The self-clearing reasons as a SQL list, built from the same constant the
 * `clearsOnImport` predicate tests: the two statements below must agree with it
 * exactly, or a refresh matches nothing and the failures list grows a duplicate
 * complaint per re-drop. No user input reaches this.
 */
const SELF_CLEARING = CLEARS_ON_IMPORT.map((reason) => `'${reason}'`).join(',')

/**
 * Work that outlived a cancel. Not a run: no progress strip counts it, but the
 * rows still finish. Negative so it can never collide with a real session.
 */
const CANCELLED_SESSION = -1

/**
 * Invariant 3 (ownership) as text, once: the sweep can reclaim a job whose
 * worker is merely slow, and the loser must not close it out. Every statement
 * that settles a claimed row interpolates this rather than restating it.
 */
const OWNED_CLAIM = `WHERE id = ? AND state = 'claimed' AND claimed_by = ?`

/** A failure with no job behind it — the definition of a rejection row. */
const REJECTION_ROW = `canonical_path = ? AND image_id IS NULL`

/**
 * Exported for the query-plan pins in migrate.test.ts: the plan assertions must
 * run over the shipped text, or they pin a hand-copy that silently drifts.
 */
export const LIST_READY_SQL = `
      SELECT * FROM images WHERE status = 'ready'
      ORDER BY captured_at DESC, id DESC LIMIT ?`

export const DELETE_IMAGE_SQL = 'DELETE FROM images WHERE id = ?'

export const CLEAR_REJECTION_SQL = `
      DELETE FROM ingestion_log
       WHERE ${REJECTION_ROW}
         AND error IN (${SELF_CLEARING})`

/** The only place SQL text lives outside migrations. Prepared once per connection. */
export function createQueries(db: DatabaseSync) {
  return {
    // ---- images -------------------------------------------------------------
    // DO NOTHING + RETURNING: a duplicate yields no row. The unique index is
    // the dedupe, not an application-side existence check.
    insertPendingImage: db.prepare(`
      INSERT INTO images (canonical_path, source_path, status, imported_at)
      VALUES (?, ?, 'pending', ?)
      ON CONFLICT(canonical_path) DO NOTHING
      RETURNING id`),

    getImage: db.prepare('SELECT * FROM images WHERE id = ?'),

    imageIdForPath: db.prepare('SELECT id FROM images WHERE canonical_path = ?'),

    // The protocol hot path: one round trip per tile paint during a fast
    // scroll, so it reads two columns rather than materialising all of them.
    getDerivatives: db.prepare('SELECT thumb_path, display_path FROM images WHERE id = ?'),

    listReady: db.prepare(LIST_READY_SQL),

    markReady: db.prepare(`
      UPDATE images SET status = 'ready', bytes = ?, width = ?, height = ?, format = ?,
             captured_at = ?, mtime_ms = ?, thumb_path = ?, display_path = ?,
             metadata_json = ?, checked_at = ?
       WHERE id = ?`),

    markImageFailed: db.prepare(`UPDATE images SET status = 'failed' WHERE id = ?`),

    markDrift: db.prepare('UPDATE images SET drift = ?, checked_at = ?, mtime_ms = ? WHERE id = ?'),

    deleteImage: db.prepare(DELETE_IMAGE_SQL),

    // ---- queue --------------------------------------------------------------
    enqueue: db.prepare(`
      INSERT INTO ingestion_log (image_id, canonical_path, state, session, enqueued_at)
      VALUES (?, ?, 'pending', ?, ?) RETURNING id`),

    // Rejected before there was ever a job, so image_id stays null and
    // finished_at is set at once: the row was over the moment it was written.
    recordRejection: db.prepare(`
      INSERT INTO ingestion_log (image_id, canonical_path, state, session, enqueued_at, finished_at, error)
      VALUES (NULL, ?, 'failed', ?, ?, ?, ?)`),

    // Refresh rather than insert, so dropping the same folder twice does not
    // grow the list by a second copy of one complaint. Keyed by kind as well as
    // path: a guard can name the very file a rejection names, and collapsing
    // the two would throw away the truncation notice.
    refreshRejection: db.prepare(`
      UPDATE ingestion_log
         SET state = 'failed', error = ?, session = ?, enqueued_at = ?, finished_at = ?
       WHERE ${REJECTION_ROW}
         AND (error IN (${SELF_CLEARING})) = ?
      RETURNING id`),

    // A WAL reader takes no write lock; the claim below opens a write
    // transaction even when it matches nothing, so idle polling goes here.
    peekPending: db.prepare(`SELECT id FROM ingestion_log WHERE state = 'pending' LIMIT 1`),

    // Claimed counts as outstanding: a run is not over while a worker is in
    // one. Scoped to the run being asked about, because a claim surviving a
    // cancel would otherwise hold "anything outstanding anywhere" true forever.
    peekOutstanding: db.prepare(`
      SELECT id FROM ingestion_log
       WHERE session = ? AND state IN ('pending','claimed') LIMIT 1`),

    // Cancelled work is excluded, or it is read back as the live run at launch
    // and the machine latches: new work joins CANCELLED_SESSION and the run
    // never ends again.
    maxSession: db.prepare(
      `SELECT MAX(session) AS session FROM ingestion_log WHERE session >= 0`
    ),

    // AND state='pending' makes the claim conditional: two workers racing
    // cannot both win, because SQLite serialises the writes.
    claim: db.prepare(`
      UPDATE ingestion_log
         SET state = 'claimed', claimed_by = ?, claimed_at = ?, attempts = attempts + 1
       WHERE id = (SELECT id FROM ingestion_log WHERE state = 'pending'
                    ORDER BY enqueued_at, id LIMIT 1)
         AND state = 'pending'
      RETURNING *`),

    completeJob: db.prepare(`
      UPDATE ingestion_log SET state = 'done', finished_at = ?, error = NULL
       ${OWNED_CLAIM}`),

    failJob: db.prepare(`
      UPDATE ingestion_log SET state = 'failed', finished_at = ?, error = ?
       ${OWNED_CLAIM}`),

    // Renewal is what turns the claim timeout into a liveness signal: without
    // it a slow decode on a spun-down volume looks identical to a dead worker.
    renewClaim: db.prepare(`
      UPDATE ingestion_log SET claimed_at = ?
       ${OWNED_CLAIM}`),

    releaseAbandoned: db.prepare(`
      UPDATE ingestion_log SET state = 'pending', claimed_by = NULL, claimed_at = NULL
       WHERE state = 'claimed' AND (claimed_at IS NULL OR claimed_at <= ?)`),

    // Every claim increments attempts, so a file that kills its worker keeps
    // cycling claim → die → respawn → sweep. This is what eventually gives up
    // and surfaces the file in the failures list instead.
    failExhausted: db.prepare(`
      UPDATE ingestion_log SET state = 'failed', finished_at = ?, error = ?
       WHERE state = 'pending' AND attempts >= ?
      RETURNING image_id`),

    // attempts resets, or the row goes straight back to failExhausted. The
    // session moves too, so the retried work runs inside the run the footer is
    // counting. image_id must exist: a rejection has no job to redo.
    retryJob: db.prepare(`
      UPDATE ingestion_log SET state = 'pending', claimed_by = NULL, claimed_at = NULL,
             error = NULL, finished_at = NULL, attempts = 0, session = ?, retried = 1
       WHERE id = ? AND state = 'failed' AND image_id IS NOT NULL
      RETURNING image_id`),

    // Guarded on 'failed' so a row a retry already handed back to a worker is
    // never deleted underneath it.
    dismissFailure: db.prepare(`
      DELETE FROM ingestion_log WHERE id = ? AND state = 'failed' RETURNING image_id`),

    // The batch form of dismissal, same two-table story: images first (their
    // FK cascade takes the jobs with them), never touching a 'ready' row, then
    // whatever failed rows remain — rejections with no image, and jobs whose
    // image finished despite them.
    dismissAllFailedImages: db.prepare(`
      DELETE FROM images
       WHERE status <> 'ready'
         AND id IN (SELECT image_id FROM ingestion_log
                     WHERE state = 'failed' AND image_id IS NOT NULL)`),

    dismissAllFailures: db.prepare(`DELETE FROM ingestion_log WHERE state = 'failed'`),

    // Dismissal takes the images row too, else the unique index keeps rejecting
    // the file as a duplicate forever. Guards a 'ready' row: fail() writes two
    // statements without a transaction, so a busy database can leave the job
    // failed while the image finished.
    deleteDismissedImage: db.prepare(`DELETE FROM images WHERE id = ? AND status <> 'ready'`),

    // Delete the image, not the job: the FK cascade removes the job, and an
    // orphaned images row would be stranded at 'pending' forever.
    cancelPending: db.prepare(`
      DELETE FROM images
       WHERE status = 'pending'
         AND id IN (SELECT image_id FROM ingestion_log
                     WHERE state = 'pending' AND retried = 0 AND session = ?)`),

    resetImageToPending: db.prepare(`UPDATE images SET status = 'pending' WHERE id = ?`),

    // A rejection has no job behind it, so nothing else would ever clear it —
    // and left standing it says the file did not arrive after it has. Scoped to
    // file-content complaints: a walk-count row names the file the walk stopped
    // at, and importing that one file must not erase a truncation notice.
    clearRejection: db.prepare(CLEAR_REJECTION_SQL),

    // A folder that reads is no longer unreadable; a later walk proves exactly that.
    clearFolderComplaint: db.prepare(`
      DELETE FROM ingestion_log
       WHERE ${REJECTION_ROW} AND error = 'folder-unreadable'`),

    // Cancel ends the run but keeps work already in flight. That work belongs
    // to no run afterwards, or it holds the cancelled run open and every drop
    // in the meantime inherits its done count.
    detachCancelledClaims: db.prepare(`
      UPDATE ingestion_log SET session = ${CANCELLED_SESSION}
       WHERE state = 'claimed' AND session = ? AND session >= 0`),

    // Retried work survives a cancel but not inside the cancelled run.
    carryRetriedForward: db.prepare(`
      UPDATE ingestion_log SET session = ?
       WHERE state = 'pending' AND retried = 1 AND session = ?`),

    // A worker commits markReady and closes the job as a separate statement, so
    // a quit in between leaves a job behind its own finished image.
    settleFinished: db.prepare(`
      UPDATE ingestion_log SET state = 'done', finished_at = ?
       WHERE state IN ('pending','claimed')
         AND image_id IN (SELECT id FROM images WHERE status = 'ready')`),

    counts: db.prepare(`
      SELECT state, COUNT(*) AS n FROM ingestion_log WHERE session = ? GROUP BY state`),

    // Unscoped, unlike counts: the failures list is the library's history of
    // what never arrived, and a file that failed two imports ago is still absent.
    listFailures: db.prepare(`
      SELECT * FROM ingestion_log WHERE state = 'failed'
       ORDER BY finished_at DESC, id DESC LIMIT ?`),

    countFailures: db.prepare(`SELECT COUNT(*) AS n FROM ingestion_log WHERE state = 'failed'`),

    // ---- deletions ----------------------------------------------------------
    logDeletion: db.prepare(`
      INSERT INTO deletions_log (image_id, source_path, mode, deleted_on, error)
      VALUES (?, ?, ?, ?, ?)`)
  }
}

export type Queries = ReturnType<typeof createQueries>

/** One typed reading of getImage instead of a hand-written cast per call site. */
export const getImageRow = (q: Queries, id: number): ImageRow | null =>
  (q.getImage.get(id) as ImageRow | undefined) ?? null

/** SQLite returns the pragma name as the column, which is easy to mistype by hand. */
export const userVersion = (db: DatabaseSync): number =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
