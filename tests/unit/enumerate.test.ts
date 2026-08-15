import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enumerateImages, DEFAULT_LIMITS } from '../../src/main/ingest/enumerate.js'
import { tempDir } from '../helpers.js'

const root = tempDir('enumerate')

const file = (relative: string, bytes = 10): string => {
  const path = join(root.path, relative)
  writeFileSync(path, Buffer.alloc(bytes))
  return path
}
const dir = (relative: string): string => {
  const path = join(root.path, relative)
  mkdirSync(path, { recursive: true })
  return path
}

describe('enumerateImages', () => {
  it('accepts supported files and silently skips other extensions inside a walk', async () => {
    const folder = dir('a')
    file('a/keep.jpg')
    file('a/keep.PNG') // extension match is case-insensitive
    file('a/skip.txt')
    const out = await enumerateImages([folder])
    expect(out.files.map((f) => f.path).sort()).toEqual(
      [join(folder, 'keep.PNG'), join(folder, 'keep.jpg')].sort()
    )
    expect(out.rejected).toEqual([])
  })

  it('rejects an unsupported file the user named directly', async () => {
    const heic = file('photo.heic')
    const out = await enumerateImages([heic])
    expect(out.rejected).toEqual([{ path: heic, reason: 'unsupported' }])
  })

  it('rejects a file over the byte cap', async () => {
    const folder = dir('big')
    const large = file('big/large.jpg', 100)
    const out = await enumerateImages([folder], { ...DEFAULT_LIMITS, maxBytes: 50 })
    expect(out.files).toEqual([])
    expect(out.rejected).toEqual([{ path: large, reason: 'too-large' }])
  })

  it('rejects a missing path as unreadable', async () => {
    const ghost = join(root.path, 'ghost.jpg')
    const out = await enumerateImages([ghost])
    expect(out.rejected).toEqual([{ path: ghost, reason: 'unreadable' }])
  })

  it('prunes a too-deep branch, reports it, and keeps walking the rest', async () => {
    const folder = dir('deep')
    file('deep/shallow.jpg')
    dir('deep/l1/l2')
    file('deep/l1/l2/buried.jpg')
    const out = await enumerateImages([folder], { ...DEFAULT_LIMITS, maxDepth: 2 })
    expect(out.files.map((f) => f.path)).toEqual([join(folder, 'shallow.jpg')])
    expect(out.guardHit?.kind).toBe('depth')
  })

  it('stops at the file cap and reports where', async () => {
    const folder = dir('many')
    for (let i = 0; i < 5; i++) file(`many/f${i}.jpg`)
    const out = await enumerateImages([folder], { ...DEFAULT_LIMITS, maxFiles: 3 })
    expect(out.files).toHaveLength(3)
    expect(out.guardHit?.kind).toBe('count')
  })

  it('counts rejections against the cap too, so an all-rejected drop is still bounded', async () => {
    const folder = dir('overcap')
    for (let i = 0; i < 5; i++) file(`overcap/f${i}.jpg`, 100)
    const out = await enumerateImages([folder], { ...DEFAULT_LIMITS, maxFiles: 3, maxBytes: 50 })
    expect(out.rejected).toHaveLength(3)
    expect(out.guardHit?.kind).toBe('count')
  })

  it('reports a symlinked folder inside the walk instead of following it', async () => {
    const folder = dir('linked')
    const target = dir('elsewhere')
    file('elsewhere/hidden.jpg')
    const link = join(folder, 'sub')
    symlinkSync(target, link)
    const out = await enumerateImages([folder])
    expect(out.files).toEqual([])
    expect(out.rejected).toEqual([{ path: link, reason: 'folder-skipped' }])
  })

  it('follows a symlinked folder the user dropped directly', async () => {
    const target = dir('real')
    file('real/photo.jpg')
    const link = join(root.path, 'alias')
    symlinkSync(target, link)
    const out = await enumerateImages([link])
    expect(out.files).toHaveLength(1)
  })

  it('records which directories it managed to read', async () => {
    const folder = dir('scanme')
    dir('scanme/sub')
    const out = await enumerateImages([folder])
    expect(out.scanned.sort()).toEqual([folder, join(folder, 'sub')].sort())
  })
})
