import type { Point, Size } from './zoom.js'

/**
 * Where a context menu opened at a point actually goes. It flips to the other
 * side of the pointer rather than sliding along the edge: a menu that slides
 * ends up under the cursor with the first item already hovered.
 */
export function menuPosition(at: Point, menu: Size, viewport: Size): Point {
  const flippedX = at.x + menu.width > viewport.width ? at.x - menu.width : at.x
  const flippedY = at.y + menu.height > viewport.height ? at.y - menu.height : at.y
  // A menu larger than the window has nowhere to flip to; the edge wins over
  // the pointer — better to lose the last item than the first.
  return { x: Math.max(0, flippedX), y: Math.max(0, flippedY) }
}
