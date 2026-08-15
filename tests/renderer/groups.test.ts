import { describe, expect, it } from 'vitest'
import { applyFilters, facets, groupImages, groupValue } from '../../src/renderer/groups.js'
import type { ImageRow } from '../../src/shared/types.js'

const image = (partial: Partial<ImageRow>): ImageRow =>
  ({
    id: 0,
    source_path: '/photos/dive.jpg',
    captured_at: Date.UTC(2024, 4, 15),
    imported_at: Date.UTC(2024, 5, 1),
    format: 'jpeg',
    ...partial
  }) as ImageRow

// A tiny library spanning two folders, two formats, two capture months.
const library: ImageRow[] = [
  image({ id: 1, source_path: '/a/dive1/x.jpg', format: 'jpeg', captured_at: Date.UTC(2024, 4, 1) }),
  image({ id: 2, source_path: '/a/dive1/y.tif', format: 'tiff', captured_at: Date.UTC(2024, 4, 2) }),
  image({ id: 3, source_path: '/a/dive2/z.jpg', format: 'jpeg', captured_at: Date.UTC(2024, 5, 3) }),
  image({ id: 4, source_path: '/a/dive2/w.jpg', format: 'jpeg', captured_at: null })
]

describe('groupValue', () => {
  it('buckets dates by month and answers unknown for an absent one', () => {
    expect(groupValue(library[0]!, 'captured')).toMatch(/2024/)
    expect(groupValue(library[3]!, 'captured')).toBe('unknown')
  })

  it('names the parent folder, not the whole path', () => {
    expect(groupValue(library[0]!, 'folder')).toBe('dive1')
    expect(groupValue(image({ source_path: '/lone.jpg' }), 'folder')).toBe('/')
  })

  it('upcases the decoder format', () => {
    expect(groupValue(library[1]!, 'format')).toBe('TIFF')
  })
})

describe('applyFilters', () => {
  it('composes dimensions with AND', () => {
    const both = applyFilters(library, { folder: 'dive2', format: 'JPEG' })
    expect(both.map((i) => i.id)).toEqual([3, 4])
    expect(applyFilters(library, { folder: 'dive1', format: 'TIFF' }).map((i) => i.id)).toEqual([2])
  })

  it('is the identity with no filters', () => {
    expect(applyFilters(library, {})).toHaveLength(4)
  })
})

describe('facets — the cross-filter rule', () => {
  it('counts a dimension against the rows passing every OTHER filter', () => {
    // Folder filtered to dive1; the format facet must still count only dive1…
    const formatFacets = facets(library, { folder: 'dive1' }, 'format')
    expect(formatFacets).toEqual([
      { value: 'JPEG', count: 1 },
      { value: 'TIFF', count: 1 }
    ])
    // …while the folder facet ignores its own filter, so dive2 stays switchable.
    const folderFacets = facets(library, { folder: 'dive1' }, 'folder')
    expect(folderFacets.map((f) => f.value).sort()).toEqual(['dive1', 'dive2'])
  })

  it('ranks unordered dimensions by count', () => {
    expect(facets(library, {}, 'format')[0]).toEqual({ value: 'JPEG', count: 3 })
  })
})

describe('groupImages', () => {
  it('sections in chip order and loses no image', () => {
    const grouped = groupImages(library, 'folder')
    expect(grouped.map((g) => g.value)).toEqual(['dive1', 'dive2'])
    expect(grouped.flatMap((g) => g.images)).toHaveLength(4)
  })
})
