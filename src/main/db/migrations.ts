/**
 * Forward only. Index + 1 is the schema version, held in PRAGMA user_version.
 * Never edit a shipped entry; append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE images (
    id             INTEGER PRIMARY KEY,
    canonical_path TEXT    NOT NULL UNIQUE,  -- the duplicate-import guard
    source_path    TEXT    NOT NULL,
    status         TEXT    NOT NULL CHECK (status IN ('pending','ready','failed')),
    drift          TEXT    NOT NULL DEFAULT 'fresh' CHECK (drift IN ('fresh','modified','missing')),
    bytes          INTEGER,
    width          INTEGER,
    height         INTEGER,
    format         TEXT,
    captured_at    INTEGER,
    imported_at    INTEGER NOT NULL,
    checked_at     INTEGER,
    mtime_ms       INTEGER,
    thumb_path     TEXT,
    display_path   TEXT,
    -- EXIF-derived facts as a blob: nothing in it is ever a WHERE clause, and a
    -- re-import rebuilds it. captured_at stays a column because it is the sort key.
    metadata_json  TEXT
  );
  -- Leads with status so the query that draws the grid uses one index for both
  -- its filter and its order, instead of sorting in a temp B-tree per list call.
  CREATE INDEX images_ready_order ON images (status, captured_at DESC, id DESC);

  -- The durable work queue and the failure history in one table. claimed_by /
  -- claimed_at let a launch tell an abandoned row from one a live worker holds.
  CREATE TABLE ingestion_log (
    id             INTEGER PRIMARY KEY,
    image_id       INTEGER REFERENCES images(id) ON DELETE CASCADE,
    canonical_path TEXT    NOT NULL,
    state          TEXT    NOT NULL CHECK (state IN ('pending','claimed','done','failed')),
    attempts       INTEGER NOT NULL DEFAULT 0,
    -- One import run. 'done' rows are never pruned, so progress counted over the
    -- whole table would open a second import's bar at 5000/5010.
    session        INTEGER NOT NULL DEFAULT 0,
    claimed_by     TEXT,
    claimed_at     INTEGER,
    enqueued_at    INTEGER NOT NULL,
    finished_at    INTEGER,
    error          TEXT,
    -- Set by a user retry so cancel can leave that work alone.
    retried        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ingestion_log_claim ON ingestion_log (state, enqueued_at, id);
  CREATE INDEX ingestion_log_session ON ingestion_log (session, state);
  -- Clearing a standing rejection on import is a per-insert DELETE; without this
  -- it scans the library's whole import history inside the write transaction.
  CREATE INDEX ingestion_log_path ON ingestion_log (canonical_path);

  -- Append-only record of every remove/delete-original, including failed ones.
  CREATE TABLE deletions_log (
    id          INTEGER PRIMARY KEY,
    image_id    INTEGER,
    source_path TEXT    NOT NULL,
    mode        TEXT    NOT NULL CHECK (mode IN ('library','original')),
    deleted_on  INTEGER NOT NULL,
    error       TEXT
  );
  `,

  `
  -- The FK cascade off images has to find its children, and without an index on
  -- the referencing column that is a scan of the whole import history per row
  -- deleted. 'done' rows are never pruned, so the cost grows with the library's
  -- age rather than its queue: measured at 20k images, deleting 2000 rows went
  -- 1450ms → 6ms. Every image delete pays it — trashing a selection, dismissing
  -- the failures list, cancelling a drop.
  CREATE INDEX ingestion_log_image ON ingestion_log (image_id);
  `
]
