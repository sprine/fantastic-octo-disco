import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DERIVATIVE_SIZES, deriveImage } from '../../src/main/ingest/derive.js'
import { DISPLAY_DERIVATIVE_PX } from '../../src/shared/types.js'
import { tempDir } from '../helpers.js'

const root = tempDir('derive')

describe('deriveImage', () => {
  // derive.ts cannot import the shared constant's module owner both ways, so
  // the two are pinned here: a change to one fails instead of drifting.
  it('resizes to the ceiling the shared contract promises the renderer', () => {
    expect(DERIVATIVE_SIZES.display).toBe(DISPLAY_DERIVATIVE_PX)
  })

  it('writes a complete webp pair and leaves no scratch files behind', async () => {
    const source = join(root.path, 'source.png')
    await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#446' } })
      .png()
      .toFile(source)

    const derived = await deriveImage(source, 7, root.path)

    expect(derived.width).toBe(3000)
    expect(derived.height).toBe(1500)
    expect(existsSync(derived.thumbPath)).toBe(true)
    expect(existsSync(derived.displayPath)).toBe(true)
    expect(readdirSync(root.path).filter((f) => f.endsWith('.tmp'))).toEqual([])

    // Ceilings, never floors: the long edge is capped, never enlarged.
    const display = await sharp(derived.displayPath).metadata()
    expect(Math.max(display.width, display.height)).toBe(DERIVATIVE_SIZES.display)
    const thumb = await sharp(derived.thumbPath).metadata()
    expect(Math.max(thumb.width, thumb.height)).toBe(DERIVATIVE_SIZES.thumb)
  })

  it('never enlarges a small image', async () => {
    const source = join(root.path, 'small.png')
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#464' } })
      .png()
      .toFile(source)
    const derived = await deriveImage(source, 8, root.path)
    const display = await sharp(derived.displayPath).metadata()
    expect(display.width).toBe(64)
    expect(display.height).toBe(48)
  })

  it('cleans up its own scratch files when the decode fails', async () => {
    const source = join(root.path, 'broken.jpg')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .png()
      .toFile(source) // a PNG wearing a .jpg name decodes fine…
    const truncated = join(root.path, 'truncated.jpg')
    await import('node:fs/promises').then((fs) => fs.writeFile(truncated, Buffer.from('JFIF')))

    await expect(deriveImage(truncated, 9, root.path)).rejects.toThrow()
    expect(readdirSync(root.path).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
