/**
 * Straight off the mockup: 170px tiles, 12px gutter, 16px inset, 24px row gap.
 * Its own module because Drawer and Grid both need these, and importing them
 * from their parent made the component graph a cycle.
 */
import { COLUMN_SNAPS } from '../shared/settings.js'

export const TILE = 170
export const GUTTER = 12
export const ROW_GAP = 24
export const PADDING = 16
/** The grid's scrollbar gutter, reserved whether or not it is scrolling; without
 *  it the tiles overflow their padding and sit flush against the scrollbar. */
export const SCROLLBAR = 15

export const drawerWidth = (columns: number): number =>
  PADDING * 2 + SCROLLBAR + columns * TILE + (columns - 1) * GUTTER

/** Snap to a column count, so row height stays a pure function of it. */
export function nearestColumns(x: number): number {
  let best: number = COLUMN_SNAPS[0]
  for (const columns of COLUMN_SNAPS) {
    if (Math.abs(drawerWidth(columns) - x) < Math.abs(drawerWidth(best) - x)) best = columns
  }
  return best
}
