import { DISPLAY_DERIVATIVE_PX, type ImageRow } from '../shared/types.js'

/**
 * The viewer shows a ≤2560px derivative of whatever was imported; past a
 * certain zoom the user is looking at invented pixels. The honest thing is to
 * say where the ceiling is and point at the original.
 */

/**
 * The line the detail panel adds beside the original's dimensions. It states
 * the rule rather than predicting the derivative's exact size: only sharp
 * knows how it rounded. Absent when the original fits inside the ceiling —
 * then nothing is being withheld.
 */
export function displayCeiling(image: ImageRow): string | null {
  const longEdge = Math.max(image.width ?? 0, image.height ?? 0)
  if (longEdge <= DISPLAY_DERIVATIVE_PX) return null
  return `${DISPLAY_DERIVATIVE_PX} px on the long edge`
}

/**
 * The zoom at which one derivative pixel covers one physical screen pixel.
 * Above it the browser is enlarging — on a retina display well before the
 * control reads 100%. Measured from the loaded image, so a frame smaller than
 * the ceiling gets its own honest answer.
 */
export function upscaleCeiling(
  derivativePx: number,
  fittedPx: number,
  devicePixelRatio: number
): number | null {
  if (derivativePx <= 0 || fittedPx <= 0 || devicePixelRatio <= 0) return null
  return derivativePx / (fittedPx * devicePixelRatio)
}
