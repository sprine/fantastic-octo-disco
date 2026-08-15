import { describe, expect, it } from 'vitest'
import { buildGroups } from '../../src/renderer/components/DetailPanel.js'
import type { ImageRow } from '../../src/shared/types.js'

const base: ImageRow = {
  id: 1,
  canonical_path: '/photos/dive.jpg',
  source_path: '/Photos/dive.jpg',
  status: 'ready',
  drift: 'fresh',
  bytes: 2 * 1024 * 1024,
  width: 4000,
  height: 3000,
  format: 'jpeg',
  captured_at: Date.UTC(2024, 4, 1, 10, 30),
  imported_at: Date.UTC(2024, 5, 1),
  checked_at: null,
  mtime_ms: null,
  thumb_path: null,
  display_path: null,
  metadata_json: JSON.stringify({
    captureSource: 'exif',
    latitude: -33.856784,
    longitude: 151.215297,
    altitudeMetres: -42.5,
    dpi: 300
  })
}

const field = (image: ImageRow, group: string, label: string): string | undefined =>
  buildGroups(image)
    .find((g) => g.title === group)
    ?.fields.find((f) => f.label === label)?.value

describe('buildGroups', () => {
  it('labels a below-sea-level altitude as depth, unsigned', () => {
    expect(field(base, 'Location', 'Depth')).toBe('42.5 m')
    expect(field(base, 'Location', 'Elevation')).toBeUndefined()
  })

  it('renders an EXIF capture in UTC — the camera\'s own clock', () => {
    expect(field(base, 'Capture', 'Captured')).toContain('10:30')
  })

  it('calls a file-date fallback by its real name', () => {
    const mtime = {
      ...base,
      metadata_json: JSON.stringify({ captureSource: 'mtime' })
    }
    expect(field(mtime, 'Capture', 'Captured')).toBeUndefined()
    expect(field(mtime, 'Capture', 'File date')).toBeDefined()
  })

  it('says when the viewer is showing a reduced copy', () => {
    expect(field(base, 'Image', 'Displayed')).toBe('2560 px on the long edge')
    expect(field({ ...base, width: 2000, height: 1000 }, 'Image', 'Displayed')).toBeUndefined()
  })

  it('drops empty groups rather than rendering dashes', () => {
    const stripped = { ...base, metadata_json: null, captured_at: null }
    expect(buildGroups(stripped).map((g) => g.title)).not.toContain('Location')
  })

  it('survives a malformed metadata blob', () => {
    expect(() => buildGroups({ ...base, metadata_json: '{oops' })).not.toThrow()
  })

  it('only surfaces drift once it is real', () => {
    expect(field(base, 'File', 'Status')).toBeUndefined()
    expect(field({ ...base, drift: 'missing' }, 'File', 'Status')).toBe('missing')
  })
})
