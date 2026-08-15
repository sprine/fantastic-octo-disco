export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff'] as const

/** Import cap on bytes, not pixels; the decode-side pixel ceiling lives in derive.ts. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

/** Walk guards report when they trip; they never truncate silently. */
export const WALK_MAX_DEPTH = 8
export const WALK_MAX_FILES = 20_000

/** How much of the library one list call returns. Policy, so not the renderer's choice. */
export const LIBRARY_PAGE_SIZE = 500

/** The failure table is unbounded; this bounds what one query hands the renderer. */
export const FAILURE_PAGE_SIZE = 200

/**
 * Long edge of the display derivative: the resolution ceiling of everything the
 * renderer can show. derive.ts owns the resize (it pulls in sharp, which cannot
 * be imported here); a unit test pins the two together.
 */
export const DISPLAY_DERIVATIVE_PX = 2560

export type ImageStatus = 'pending' | 'ready' | 'failed'
/** Which fallback produced captured_at: EXIF, file mtime, or import time. */
export type CaptureSource = 'exif' | 'mtime' | 'import'
/** Observed lazily on display; never auto-removes a row (a missing file may be an unplugged drive). */
export type DriftState = 'fresh' | 'modified' | 'missing'
export type JobState = 'pending' | 'claimed' | 'done' | 'failed'
export type DeleteMode = 'library' | 'original'

export type ImageRow = {
  id: number
  canonical_path: string
  source_path: string
  status: ImageStatus
  drift: DriftState
  bytes: number | null
  width: number | null
  height: number | null
  format: string | null
  /** EXIF DateTimeOriginal, else mtime, else import time. */
  captured_at: number | null
  imported_at: number
  checked_at: number | null
  mtime_ms: number | null
  thumb_path: string | null
  display_path: string | null
  /** `ImageMetadata` as written by the worker. Read it with `readMetadata`. */
  metadata_json: string | null
}

/**
 * What the detail panel shows beyond the columns. Every field is optional
 * because every field is genuinely absent from some ordinary photograph.
 */
export type ImageMetadata = {
  captureSource?: CaptureSource
  /** Signed decimal degrees, north and east positive. Both or neither. */
  latitude?: number
  longitude?: number
  /** Metres against sea level, negative below it. */
  altitudeMetres?: number
  /** Pixels per inch as the file declares it, not as a decoder guesses it. */
  dpi?: number
}

/**
 * Tolerant on purpose: the blob is a cache, and a row written by another build
 * is worth an emptier panel, never a render that throws. Each field is checked
 * individually — a drifted blob parses cleanly but can hold the wrong types.
 */
export const readMetadata = (json: string | null | undefined): ImageMetadata => {
  if (!json) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}

  const raw = parsed as Record<string, unknown>
  const meta: ImageMetadata = {}
  for (const key of NUMERIC_METADATA) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) meta[key] = raw[key]
  }
  if (typeof raw.captureSource === 'string') meta.captureSource = raw.captureSource as CaptureSource
  return meta
}

const NUMERIC_METADATA = ['latitude', 'longitude', 'altitudeMetres', 'dpi'] as const satisfies
  readonly (keyof ImageMetadata)[]

export type JobRow = {
  id: number
  /** Null for a file rejected before it was ever enqueued: there is no image. */
  image_id: number | null
  canonical_path: string
  state: JobState
  attempts: number
  /** Which import run this row belongs to; progress is counted per run. */
  session: number
  claimed_by: string | null
  claimed_at: number | null
  enqueued_at: number
  finished_at: number | null
  error: string | null
  /** Set when the user asked for this job again; cancel leaves it alone. */
  retried: number
}

export type QueueCounts = Record<JobState, number>

/** The page the renderer draws, and how many exist in total. */
export type Failures = { items: JobRow[]; total: number }

/** A code, not prose: wording and units belong to the renderer. */
export type RejectReason =
  | 'too-large'
  | 'unreadable'
  | 'folder-unreadable'
  | 'folder-skipped'
  | 'unsupported'

/**
 * A complaint about one file's own content, which the file arriving disproves.
 * Everything else names a folder or a walk boundary, which a later import
 * cannot be read as answering.
 */
export const clearsOnImport = (reason: string): boolean =>
  reason === 'too-large' || reason === 'unreadable'

/** Walk guards, recorded like rejections: a truncated import that looks complete is data loss. */
export type GuardReason = 'walk-depth' | 'walk-count'

/** What ingestion_log.error holds for a failure that never became a job. */
export type FailureReason = RejectReason | GuardReason

/** A tally, not a report: the durable evidence lives in ingestion_log. */
export type EnqueueResult = {
  enqueued: number
  duplicates: number
  rejected: number
}
