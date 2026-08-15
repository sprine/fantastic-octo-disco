import exifReader from 'exif-reader'
import type { CaptureSource, ImageMetadata } from '../../shared/types.js'

/**
 * The capture time travels apart from the rest: it is the library's sort key
 * and therefore a column, while everything else is a blob nothing queries.
 */
export type ExifFacts = { capturedAt: number | null; fields: ImageMetadata }

const nothing = (): ExifFacts => ({ capturedAt: null, fields: {} })

/**
 * A photo with no EXIF is normal and a malformed block is not the file's
 * fault: both answer "nothing known" rather than failing the import. The
 * parser walks offsets out of bytes the file controls, so the catch matters.
 */
export function readExif(exif: Buffer | undefined): ExifFacts {
  if (!exif) return nothing()
  try {
    return exifFacts(exifReader(exif))
  } catch {
    return nothing()
  }
}

/** Split from the buffer so the tag rules can be exercised without a file. */
export function exifFacts(exif: ReturnType<typeof exifReader>): ExifFacts {
  const image = exif.Image ?? {}
  const gps = exif.GPSInfo ?? {}
  const fields: ImageMetadata = {}

  const dpi = resolution(image.XResolution, image.ResolutionUnit)
  if (dpi !== null) fields.dpi = dpi

  // Both or neither: half a fix is not a position.
  const latitude = coordinate(gps.GPSLatitude, gps.GPSLatitudeRef, 'S', 90)
  const longitude = coordinate(gps.GPSLongitude, gps.GPSLongitudeRef, 'W', 180)
  if (latitude !== null && longitude !== null) {
    fields.latitude = latitude
    fields.longitude = longitude
  }

  const altitude = seaLevelOffset(gps.GPSAltitude, gps.GPSAltitudeRef)
  if (altitude !== null) fields.altitudeMetres = altitude

  return { capturedAt: timestamp(exif.Photo?.DateTimeOriginal), fields }
}

/**
 * The fallback chain the whole library is ordered by: EXIF, else a plausible
 * mtime, else import time. A zero or negative mtime is a filesystem that has
 * forgotten, not a photograph taken in 1970.
 */
export function captureTime(
  capturedAt: number | null,
  mtimeMs: number | null,
  importedAt: number
): { at: number; source: CaptureSource } {
  if (capturedAt !== null) return { at: capturedAt, source: 'exif' }
  if (mtimeMs !== null && Number.isFinite(mtimeMs) && mtimeMs > 0) {
    return { at: Math.round(mtimeMs), source: 'mtime' }
  }
  return { at: importedAt, source: 'import' }
}

/**
 * EXIF's date tag is a wall clock with no zone; reading it as UTC everywhere
 * keeps one rule across the library, which matters more for ordering than
 * true instants would. The panel renders it back in UTC for the same reason.
 */
function timestamp(value: unknown): number | null {
  if (!(value instanceof Date)) return null
  const at = value.getTime()
  return Number.isFinite(at) ? at : null
}

/** Rational degrees, minutes and seconds — the only form the tag takes. */
function coordinate(
  parts: unknown,
  ref: unknown,
  negative: string,
  limit: number
): number | null {
  // The hemisphere is mandatory and gets no default: without it a Sydney dive
  // reads as northern Iraq, which is worse than no fix at all.
  if (typeof ref !== 'string') return null
  // Minutes and seconds may be absent; degrees may not — an absent tag would
  // otherwise read as a fix on the meridian.
  const [degrees, minutes = 0, seconds = 0] = Array.isArray(parts) ? parts : [parts]
  if (![degrees, minutes, seconds].every((part) => Number.isFinite(part))) return null
  const value = degrees + minutes / 60 + seconds / 3600
  if (Math.abs(value) > limit) return null // a rig writing rubbish, not a place
  return ref === negative ? -value : value
}

/**
 * Metres, signed against sea level. GPSAltitudeRef 1 is the only statement
 * ordinary EXIF can make that a frame was taken below the surface; nothing
 * else here invents a depth.
 */
function seaLevelOffset(value: unknown, ref: unknown): number | null {
  if (!Number.isFinite(value)) return null
  const metres = value as number
  if (Math.abs(metres) > MAX_ALTITUDE_METRES) return null // broken rational, not a measurement
  return ref === 1 ? -Math.abs(metres) : metres
}

/** Comfortably past the Kármán line and the Mariana Trench in either direction. */
const MAX_ALTITUDE_METRES = 100_000

/** An unsigned rational surviving a broken file must not render as 4 billion dpi. */
const MAX_DPI = 100_000

/** Unit 2, inches, is the tag's default and needs no branch of its own. */
const RESOLUTION_UNIT = { none: 1, centimetre: 3 } as const

/**
 * Read from the tag rather than sharp's `density`, which answers 72 for a
 * JPEG that declares nothing and offers no way to tell that apart from a
 * file genuinely printed at 72dpi.
 */
function resolution(value: unknown, unit: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  if (unit === RESOLUTION_UNIT.none) return null // an aspect ratio, not a density
  const dpi = unit === RESOLUTION_UNIT.centimetre ? value * 2.54 : value
  return dpi > MAX_DPI ? null : Math.round(dpi)
}
