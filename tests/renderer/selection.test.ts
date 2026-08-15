import { describe, expect, it } from 'vitest'
import { extendTo, NO_SELECTION, selectOne, type Selection } from '../../src/renderer/selection.js'

// The grid's draw order; ids are deliberately not sorted, because grouping
// reorders the flat list and ranges must follow the drawn order.
const order = [10, 3, 7, 42, 5]

const ids = (selection: Selection) => [...selection.ids].sort((a, b) => a - b)

describe('selectOne', () => {
  it('is a single id that anchors the next range', () => {
    const selection = selectOne(7)
    expect(ids(selection)).toEqual([7])
    expect(selection.anchor).toBe(7)
  })
})

describe('extendTo', () => {
  it('spans anchor to click, inclusive, in draw order', () => {
    expect(ids(extendTo(selectOne(3), order, 42))).toEqual([3, 7, 42])
  })

  it('works backwards from the anchor', () => {
    expect(ids(extendTo(selectOne(42), order, 10))).toEqual([3, 7, 10, 42])
  })

  it('keeps the anchor, so a second shift-click re-aims rather than chains', () => {
    const first = extendTo(selectOne(3), order, 5)
    const second = extendTo(first, order, 7)
    expect(ids(second)).toEqual([3, 7])
    expect(second.anchor).toBe(3)
  })

  it('falls back to a plain click when there is no anchor', () => {
    expect(ids(extendTo(NO_SELECTION, order, 7))).toEqual([7])
  })

  it('falls back to a plain click when the anchor was filtered out of view', () => {
    const selection = extendTo(selectOne(99), order, 42)
    expect(ids(selection)).toEqual([42])
    expect(selection.anchor).toBe(42)
  })
})
