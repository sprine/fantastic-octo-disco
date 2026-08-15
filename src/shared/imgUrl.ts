/**
 * The id lives in the path, never the host: `img` is a standard scheme, so
 * Chromium canonicalises its host and reads a numeric one as an IPv4 address
 * (`img://1/thumb` arrives as host 0.0.0.1).
 *
 * Formatter and parser live together so the renderer and the protocol handler
 * cannot disagree about the shape.
 */
export type Variant = 'thumb' | 'display'

const VARIANTS: readonly string[] = ['thumb', 'display'] satisfies Variant[]

export const imgUrl = (id: number, variant: Variant): string => `img://image/${id}/${variant}`

export function parseImgUrl(url: string): { id: number; variant: Variant } | null {
  const [, rawId, variant] = new URL(url).pathname.split('/')
  const id = Number(rawId)
  if (!rawId || !Number.isInteger(id) || !VARIANTS.includes(variant!)) return null
  return { id, variant: variant as Variant }
}
