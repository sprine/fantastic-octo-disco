import { describe, expect, it } from 'vitest'
import { menuPosition } from '../../src/renderer/menu.js'

const menu = { width: 180, height: 120 }
const viewport = { width: 1000, height: 800 }

describe('menuPosition', () => {
  it('opens at the pointer when there is room', () => {
    expect(menuPosition({ x: 100, y: 100 }, menu, viewport)).toEqual({ x: 100, y: 100 })
  })

  it('flips to the other side of the pointer at an edge', () => {
    expect(menuPosition({ x: 950, y: 100 }, menu, viewport)).toEqual({ x: 950 - 180, y: 100 })
    expect(menuPosition({ x: 100, y: 750 }, menu, viewport)).toEqual({ x: 100, y: 750 - 120 })
  })

  it('prefers losing the last item to losing the first', () => {
    const tiny = { width: 300, height: 200 }
    const at = menuPosition({ x: 10, y: 10 }, { width: 400, height: 300 }, tiny)
    expect(at.x).toBeGreaterThanOrEqual(0)
    expect(at.y).toBeGreaterThanOrEqual(0)
  })
})
