import { describe, expect, it } from 'vitest'
import {
  clampPan,
  FIT,
  wheelFactor,
  wheelPixels,
  zoomAt,
  ZOOM_MAX,
  ZOOM_MIN
} from '../../src/renderer/zoom.js'

describe('zoomAt', () => {
  it('keeps the anchored point stationary', () => {
    // The pixel under the pointer must land where it started: scale*p + pan
    // is the same before and after.
    const anchor = { x: 100, y: -40 }
    const before = FIT
    const after = zoomAt(before, 2, anchor)
    // Point p was at anchor: p = (anchor - pan) / scale
    const p = { x: (anchor.x - before.pan.x) / before.scale, y: (anchor.y - before.pan.y) / before.scale }
    expect(after.scale * p.x + after.pan.x).toBeCloseTo(anchor.x)
    expect(after.scale * p.y + after.pan.y).toBeCloseTo(anchor.y)
  })

  it('clamps the scale and corrects pan by the applied factor, not the requested one', () => {
    const nearMax = { scale: ZOOM_MAX / 1.1, pan: { x: 10, y: 10 } }
    const at = zoomAt(nearMax, 4, { x: 50, y: 50 })
    expect(at.scale).toBe(ZOOM_MAX)
    // A further zoom at the ceiling moves nothing: no sideways drift per notch.
    const further = zoomAt(at, 4, { x: 50, y: 50 })
    expect(further).toEqual(at)
  })

  it('respects the floor', () => {
    expect(zoomAt(FIT, 0.001, { x: 0, y: 0 }).scale).toBe(ZOOM_MIN)
  })
})

describe('clampPan', () => {
  const content = { width: 100, height: 100 }
  const viewport = { width: 200, height: 200 }

  it('snaps an image smaller than the viewport back to centre', () => {
    const pan = clampPan({ x: 50, y: -30 }, 1, content, viewport)
    expect(pan.x).toBeCloseTo(0)
    expect(pan.y).toBeCloseTo(0)
  })

  it('allows panning only as far as the overflowing half', () => {
    // 100px content at 6x = 600px; overflow 400, shared 200 a side.
    expect(clampPan({ x: 500, y: -500 }, 6, content, viewport)).toEqual({ x: 200, y: -200 })
  })
})

describe('wheel handling', () => {
  it('normalises line and page delta modes to pixels', () => {
    expect(wheelPixels(3, 1)).toBe(48)
    expect(wheelPixels(1, 2)).toBe(400)
    expect(wheelPixels(120, 0)).toBe(120)
  })

  it('scrolling up enlarges; equal notches cancel exactly', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1)
  })
})
