import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { parseImgUrl } from '../shared/imgUrl.js'
import type { Queries } from './db/queries.js'

/** Must run before app ready: scheme privileges are fixed at that point. */
export function registerImgScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'img',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * img://image/<id>/<variant>. The renderer names an id, never a path, so it
 * cannot request a file that is not in the library: the index is the
 * allowlist. The memo cache exists because a fast scroll would otherwise be
 * one database lookup per tile paint.
 */
export function registerImgProtocol(queries: Queries): { invalidate: (id: number) => void } {
  // `null` is cached as deliberately as a path: a row with no derivative yet
  // is the common case during an import.
  //
  // The invariant this buys: anything that writes thumb_path or display_path
  // must call invalidate(), or that image serves a permanent 404. Writers
  // today: the pool event handler and removeImages.
  const cache = new Map<string, string | null>()

  protocol.handle('img', async (request) => {
    const parsed = parseImgUrl(request.url)
    if (!parsed) return new Response(null, { status: 400 })

    const key = `${parsed.id}:${parsed.variant}`
    if (!cache.has(key)) {
      const row = queries.getDerivatives.get(parsed.id) as
        | { thumb_path: string | null; display_path: string | null }
        | undefined
      cache.set(key, (parsed.variant === 'thumb' ? row?.thumb_path : row?.display_path) ?? null)
    }

    const file = cache.get(key)
    if (!file) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  return {
    invalidate(id) {
      cache.delete(`${id}:thumb`)
      cache.delete(`${id}:display`)
    }
  }
}
