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
export function registerImgProtocol(queries: Queries): void {
  // Hits only, never misses, and self-healing — no invalidate seam at all.
  // A derivative path is a pure function of (id, variant), so a cached hit
  // survives re-derives and retries; the one thing that breaks it is the file
  // vanishing (deletion, a cleared thumbnail directory), and a failed serve
  // below evicts the entry itself. Caching a miss would instead demand an
  // invalidate call from every future writer of thumb_path/display_path, on
  // pain of a permanent 404 — a discipline enforceable only by a
  // hand-maintained writer list. The renderer only names ids from listReady,
  // so a miss is a race with an in-flight paint: rare, one extra lookup.
  const cache = new Map<string, string>()

  protocol.handle('img', async (request) => {
    const parsed = parseImgUrl(request.url)
    if (!parsed) return new Response(null, { status: 400 })

    const key = `${parsed.id}:${parsed.variant}`
    let file = cache.get(key)
    if (file === undefined) {
      const row = queries.getDerivatives.get(parsed.id) as
        | { thumb_path: string | null; display_path: string | null }
        | undefined
      file = (parsed.variant === 'thumb' ? row?.thumb_path : row?.display_path) ?? undefined
      if (file !== undefined) cache.set(key, file)
    }

    if (!file) return new Response(null, { status: 404 })
    try {
      const response = await net.fetch(pathToFileURL(file).toString())
      if (response.ok) return response
      cache.delete(key)
      return new Response(null, { status: 404 })
    } catch {
      // The path answered once and no longer does: a stale hit, not a bug.
      cache.delete(key)
      return new Response(null, { status: 404 })
    }
  })
}
