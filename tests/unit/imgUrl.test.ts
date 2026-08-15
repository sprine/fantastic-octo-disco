import { describe, expect, it } from 'vitest'
import { imgUrl, parseImgUrl } from '../../src/shared/imgUrl.js'

describe('imgUrl round trip', () => {
  it('parses what it formats', () => {
    expect(parseImgUrl(imgUrl(42, 'thumb'))).toEqual({ id: 42, variant: 'thumb' })
    expect(parseImgUrl(imgUrl(1, 'display'))).toEqual({ id: 1, variant: 'display' })
  })

  it('rejects a malformed id or variant', () => {
    expect(parseImgUrl('img://image/nope/thumb')).toBeNull()
    expect(parseImgUrl('img://image/1.5/thumb')).toBeNull()
    expect(parseImgUrl('img://image/1/full')).toBeNull()
    expect(parseImgUrl('img://image//thumb')).toBeNull()
  })
})
