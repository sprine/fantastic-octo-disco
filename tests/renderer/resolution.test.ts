import { describe, expect, it } from 'vitest'
import { displayCeiling, upscaleCeiling } from '../../src/renderer/resolution.js'
import { DISPLAY_DERIVATIVE_PX, type ImageRow } from '../../src/shared/types.js'

const image = (width: number | null, height: number | null): ImageRow =>
  ({ width, height }) as ImageRow

describe('displayCeiling', () => {
  it('is silent when the original fits inside the derivative', () => {
    expect(displayCeiling(image(2560, 1440))).toBeNull()
    expect(displayCeiling(image(null, null))).toBeNull()
  })

  it('states the rule when the viewer is showing a reduced copy', () => {
    expect(displayCeiling(image(8000, 6000))).toBe(`${DISPLAY_DERIVATIVE_PX} px on the long edge`)
  })
})

describe('upscaleCeiling', () => {
  it('finds the zoom where one derivative pixel covers one physical pixel', () => {
    // 2560px derivative fitted into 800 CSS px on a 2x display: ceiling 1.6.
    expect(upscaleCeiling(2560, 800, 2)).toBeCloseTo(1.6)
  })

  it('gives a small frame its own honest answer', () => {
    // A 400px derivative fitted at 800 CSS px is already enlarged below 100%.
    expect(upscaleCeiling(400, 800, 1)).toBeCloseTo(0.5)
  })

  it('answers null rather than dividing by nothing', () => {
    expect(upscaleCeiling(0, 800, 2)).toBeNull()
    expect(upscaleCeiling(2560, 0, 2)).toBeNull()
    expect(upscaleCeiling(2560, 800, 0)).toBeNull()
  })
})
