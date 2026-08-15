/**
 * The maths behind the viewer's zoom, kept out of the component so it can be
 * unit-tested without a DOM.
 *
 * The stage draws the image as `translate(pan) scale(scale)` about its centre,
 * so a point `p` in unscaled image coordinates measured from that centre lands
 * at `scale * p + pan`. Every function here is written in those coordinates.
 */
export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type View = { scale: number; pan: Point }

export const FIT: View = { scale: 1, pan: { x: 0, y: 0 } }

/** Below the lower bound there is nothing to see; above the upper, nothing to learn. */
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 8

/** What the drawn minus and plus move by. Multiplicative, so a step feels the same at 8x as at 1x. */
export const ZOOM_STEP = 1.25

/**
 * A wheel notch is ~100 pixels and a trackpad pinch arrives as a stream of
 * single figures; one exponential law in pixels serves both.
 */
const WHEEL_PIXELS_PER_E = 300
const LINE_HEIGHT = 16
const PAGE_HEIGHT = 400

/** deltaMode is lines or pages on some mice and platforms; it is not always zero. */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_HEIGHT
  if (deltaMode === 2) return deltaY * PAGE_HEIGHT
  return deltaY
}

/** Scrolling up (negative delta) enlarges — the direction every image tool uses. */
export const wheelFactor = (deltaPixels: number): number =>
  Math.exp(-deltaPixels / WHEEL_PIXELS_PER_E)

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Zoom anchored on a point rather than the centre: without this, the pixel
 * under the pointer slides away as the user zooms and they end up chasing it.
 *
 * The pan correction uses the factor actually applied after clamping, not the
 * one asked for: at either end of the range the scale stops moving, and a
 * correction from the requested factor would drift the image sideways.
 */
export function zoomAt(view: View, factor: number, anchor: Point): View {
  const scale = clamp(view.scale * factor, ZOOM_MIN, ZOOM_MAX)
  const applied = scale / view.scale
  return {
    scale,
    pan: {
      x: anchor.x - applied * (anchor.x - view.pan.x),
      y: anchor.y - applied * (anchor.y - view.pan.y)
    }
  }
}

/**
 * Panning stops at the edge of the image. The slack is however much of the
 * scaled image falls outside the viewport, halved because a centred image
 * shares its overflow between two sides — so an image smaller than the
 * viewport has no slack and snaps back to centre without a special case.
 */
export function clampPan(pan: Point, scale: number, content: Size, viewport: Size): Point {
  const slackX = Math.max(0, (content.width * scale - viewport.width) / 2)
  const slackY = Math.max(0, (content.height * scale - viewport.height) / 2)
  return { x: clamp(pan.x, -slackX, slackX), y: clamp(pan.y, -slackY, slackY) }
}
