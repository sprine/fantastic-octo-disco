import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { threadId } from 'node:worker_threads'
import sharp from 'sharp'
import { readExif, type ExifFacts } from './exif.js'

/** Ceilings, never floors. `display` must equal shared DISPLAY_DERIVATIVE_PX (pinned by test). */
export const DERIVATIVE_SIZES = { thumb: 340, display: 2560 } as const

export type DerivativeVariant = keyof typeof DERIVATIVE_SIZES

// libvips sizes itself for a process that owns the machine; two workers each
// expanding a 20MB TIF is already the ceiling the pool size exists to hold.
sharp.cache(false)
sharp.concurrency(1)

/**
 * The import cap bounds bytes on disk, not pixels: a small compressed file can
 * decode to an enormous frame. This is where the pixel bound is actually set.
 */
const MAX_INPUT_PIXELS = 268_402_689 // 16383², sharp's own default

/**
 * Tolerant of warnings, intolerant of errors: a frame that decodes with a
 * complaint is worth more to a library than a rejection.
 */
const READ = { failOn: 'error', autoOrient: true, limitInputPixels: MAX_INPUT_PIXELS } as const

/** Contain rather than crop, and never enlarge. */
const contain = (size: number) =>
  ({ width: size, height: size, fit: 'inside', withoutEnlargement: true }) as const

export type Derived = {
  width: number
  height: number
  format: string
  thumbPath: string
  displayPath: string
  exif: ExifFacts
}

/**
 * Named for the image id, never for the content: removeImage deletes
 * derivatives unconditionally, and content-addressed sharing without a
 * refcount would let dropping one row blank an unrelated survivor.
 */
const derivativePath = (dir: string, imageId: number, variant: DerivativeVariant): string =>
  join(dir, `${imageId}-${variant}.webp`)

/**
 * Attempt-scoped, so two attempts at one image never write the same bytes: the
 * sweep can hand a job to a second worker while the first is still alive.
 */
let attempt = 0
const scratchPath = (dir: string, imageId: number, variant: DerivativeVariant): string =>
  join(dir, `.${imageId}-${variant}.${threadId}.${attempt}.tmp`)

/**
 * The full frame is expanded once: the display derivative comes from the
 * original, the thumbnail from the display copy, so the second resize is cheap
 * however large the source. Chromium cannot decode TIF at all, so what this
 * writes is the only form of the image the renderer will ever see.
 */
export async function deriveImage(
  sourcePath: string,
  imageId: number,
  dir: string
): Promise<Derived> {
  const thumbPath = derivativePath(dir, imageId, 'thumb')
  const displayPath = derivativePath(dir, imageId, 'display')

  attempt++
  const thumbScratch = scratchPath(dir, imageId, 'thumb')
  const displayScratch = scratchPath(dir, imageId, 'display')

  try {
    await mkdir(dir, { recursive: true }) // one syscall; survives a tidied-away data dir

    const meta = await sharp(sourcePath, READ).metadata()
    const display = await sharp(sourcePath, READ)
      .resize(contain(DERIVATIVE_SIZES.display))
      .webp()
      .toBuffer()
    await writeFile(displayScratch, display)
    await sharp(display).resize(contain(DERIVATIVE_SIZES.thumb)).webp().toFile(thumbScratch)

    // Both files are complete before either takes its final name: a reader can
    // only ever see a whole pair, and a losing attempt in a reclaimed-job race
    // replaces atomically rather than tearing.
    await rename(displayScratch, displayPath)
    await rename(thumbScratch, thumbPath)

    return {
      // Oriented dimensions, not the header's: the derivatives above have
      // already been rotated upright.
      width: meta.autoOrient.width,
      height: meta.autoOrient.height,
      format: meta.format,
      thumbPath,
      displayPath,
      // The header the decoder already read; parsing here keeps the file opened once.
      exif: readExif(meta.exif)
    }
  } catch (error) {
    // Only this attempt's scratch files: removing the final paths could delete
    // a concurrent successful attempt's output under a 'ready' row.
    await Promise.all([rm(thumbScratch, { force: true }), rm(displayScratch, { force: true })])
    throw error
  }
}
