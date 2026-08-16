import type { ImageRow } from '../shared/types.js'

/**
 * The grouping bar's whole vocabulary, kept as pure functions so the
 * cross-filter arithmetic tests without a DOM. Everything works on the page
 * of rows the renderer already holds — no new queries.
 */
export const GROUP_KEYS = ['imported', 'captured', 'folder', 'format'] as const
export type GroupKey = (typeof GROUP_KEYS)[number]

/** One value per dimension; dimensions compose with AND. */
export type Filters = Partial<Record<GroupKey, string>>

export const GROUP_LABELS: Record<GroupKey, string> = {
  imported: 'imported',
  captured: 'file date',
  folder: 'folder',
  format: 'format'
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' })

// Every pass over the page asks for the same handful of labels, and formatting
// one costs about thirty times what looking it up does.
const labels = new Map<number, string>()

/** Months, not days: a bar of one chip per day is a list, not a grouping. */
const month = (at: number | null): string => {
  if (at === null) return 'unknown'
  let label = labels.get(at)
  if (label === undefined) {
    const date = new Date(at)
    label = `${MONTH.format(date)} ${date.getFullYear()}`
    labels.set(at, label)
  }
  return label
}

export function groupValue(image: ImageRow, key: GroupKey): string {
  switch (key) {
    case 'imported':
      return month(image.imported_at)
    case 'captured':
      return month(image.captured_at)
    case 'folder':
      // The parent folder's own name: the full path belongs in a tooltip, not a chip.
      return image.source_path.split(/[\\/]/).slice(-2, -1)[0] || '/'
    case 'format':
      return image.format?.toUpperCase() ?? 'unknown'
  }
}

export const applyFilters = (images: ImageRow[], filters: Filters): ImageRow[] =>
  images.filter((image) =>
    GROUP_KEYS.every((key) => !filters[key] || groupValue(image, key) === filters[key])
  )

export type Facet = { value: string; count: number }

/**
 * Counts for one dimension, computed against the rows that pass every OTHER
 * dimension's filter — the cross-filter rule. Counting against the fully
 * filtered set instead would collapse the open dimension to its own selection
 * and there would be nothing left to switch to.
 *
 * Date dimensions keep the library's own (capture-ordered) encounter order;
 * the unordered ones rank by count, since the biggest bucket is the one a
 * larger library most wants first.
 */
export function facets(images: ImageRow[], filters: Filters, key: GroupKey): Facet[] {
  const others = { ...filters }
  delete others[key]
  const counts = new Map<string, number>()
  for (const image of applyFilters(images, others)) {
    const value = groupValue(image, key)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const list = [...counts].map(([value, count]) => ({ value, count }))
  return key === 'folder' || key === 'format' ? list.sort((a, b) => b.count - a.count) : list
}

export type Grouped = { value: string; images: ImageRow[] }

/** The grid's sections, in the same order the chips present. */
export function groupImages(images: ImageRow[], key: GroupKey): Grouped[] {
  const order = facets(images, {}, key).map((facet) => facet.value)
  const buckets = new Map<string, ImageRow[]>(order.map((value) => [value, []]))
  for (const image of images) buckets.get(groupValue(image, key))!.push(image)
  return order.map((value) => ({ value, images: buckets.get(value)! }))
}
