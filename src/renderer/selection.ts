/**
 * Multi-selection over the grid's visible order. Pure — like the other
 * renderer maths, so it tests without a DOM.
 *
 * The anchor is the last plain click; shift-click re-aims the range from it,
 * which is what every native list does. The range is computed over the drawn
 * order, not database order: grouping reorders the grid and a range must
 * follow the eye.
 */
export type Selection = { ids: ReadonlySet<number>; anchor: number | null }

export const NO_SELECTION: Selection = { ids: new Set(), anchor: null }

export const selectOne = (id: number): Selection => ({ ids: new Set([id]), anchor: id })

/**
 * Shift-click. Replaces the set with anchor→id, keeping the anchor so the next
 * shift-click re-aims rather than chains. An anchor filtered out of view falls
 * back to a plain click: a range the user cannot see is not a range.
 */
export function extendTo(selection: Selection, order: number[], id: number): Selection {
  const from = selection.anchor === null ? -1 : order.indexOf(selection.anchor)
  const to = order.indexOf(id)
  if (from === -1 || to === -1) return selectOne(id)
  const [lo, hi] = from < to ? [from, to] : [to, from]
  return { ids: new Set(order.slice(lo, hi + 1)), anchor: selection.anchor }
}
