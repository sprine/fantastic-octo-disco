import { stat } from 'node:fs/promises'
import { getImageRow, type Queries } from '../db/queries.js'
import type { JobRow } from '../../shared/types.js'
import { deriveImage } from './derive.js'
import { captureTime } from './exif.js'

/**
 * One image, decoded and derived. The order is the whole crash story: the row
 * is already 'pending', the derivatives land on disk, and only then does it
 * flip to 'ready'. A crash strands scratch files, never a ready row pointing
 * at a derivative that was never written.
 */
export async function processJob(
  q: Queries,
  job: JobRow,
  derivativesDir: string,
  now = Date.now()
): Promise<void> {
  const imageId = job.image_id
  if (imageId === null) throw new Error(`job ${job.id} has no image`)
  const image = getImageRow(q, imageId)
  if (!image) throw new Error(`image ${imageId} left the library before it was processed`)

  const info = await stat(image.source_path)
  const derived = await deriveImage(image.source_path, imageId, derivativesDir)

  // The row's own import time, not this worker's clock: a job resumed at the
  // next launch belongs to the import that enqueued it.
  const captured = captureTime(derived.exif.capturedAt, info.mtimeMs, image.imported_at)

  q.markReady.run(
    info.size,
    derived.width,
    derived.height,
    derived.format, // the decoder's answer, not the extension's claim
    captured.at,
    Math.round(info.mtimeMs),
    derived.thumbPath,
    derived.displayPath,
    // Which fallback answered travels with the fields, or the panel cannot
    // tell a capture time from a file date.
    JSON.stringify({ ...derived.exif.fields, captureSource: captured.source }),
    now,
    imageId
  )
}
