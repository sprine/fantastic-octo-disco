import { describe, expect, it } from 'vitest'
import {
  drawerWidth,
  nearestColumns,
  GUTTER,
  PADDING,
  SCROLLBAR,
  TILE,
} from '../../src/renderer/layout.js'
import { COLUMN_SNAPS } from '../../src/shared/settings.js'

describe('drawerWidth', () => {
  it('matches the mockup at two columns', () => {
    // app.svg: drawer x8..x399 = 391px of tiles and inset, plus the scroll gutter.
    expect(drawerWidth(2)).toBe(PADDING * 2 + SCROLLBAR + 2 * TILE + GUTTER)
    expect(drawerWidth(2)).toBe(399)
  })
})

describe('nearestColumns', () => {
  it('answers each snap exactly at its own width', () => {
    for (const columns of COLUMN_SNAPS) {
      expect(nearestColumns(drawerWidth(columns))).toBe(columns)
    }
  })

  it('snaps a drag between two widths to the closer one', () => {
    const midpoint = (drawerWidth(2) + drawerWidth(3)) / 2
    expect(nearestColumns(midpoint - 10)).toBe(2)
    expect(nearestColumns(midpoint + 10)).toBe(3)
  })

  it('clamps a drag past either end to the nearest snap', () => {
    expect(nearestColumns(0)).toBe(COLUMN_SNAPS[0])
    expect(nearestColumns(10_000)).toBe(COLUMN_SNAPS[COLUMN_SNAPS.length - 1]!)
  })
})
