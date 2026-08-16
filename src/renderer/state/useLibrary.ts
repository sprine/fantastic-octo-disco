import { useCallback, useEffect, useRef, useState } from 'react'
import type { Failures, ImageRow, QueueCounts } from '../../shared/types.js'
import { zeroCounts } from '../../shared/types.js'
import { shallowEqual } from './shallowEqual.js'

// Each refresh is three IPC round trips including a full page of rows, and
// capture-date order scatters new images into the middle rather than on top,
// so refreshing faster than this shows the user almost nothing.
const REFRESH_MS = 500

/** The one hook holding library state. Selection lives in App: it is view state, not data. */
export function useLibrary() {
  const [images, setImages] = useState<ImageRow[]>([])
  const [counts, setCounts] = useState<QueueCounts>(zeroCounts)
  const [failures, setFailures] = useState<Failures>({ items: [], total: 0 })
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const [rows, queueCounts, failed] = await Promise.all([
      window.api.library.list(),
      window.api.ingest.counts(),
      window.api.ingest.failures()
    ])
    // Each IPC round trip clones every row, but the grid's memoised tiles key
    // on object identity: reconciled against the previous state, an import's
    // twice-a-second refresh re-renders only the tiles whose rows changed
    // instead of the whole page.
    setImages((current) => {
      const previous = new Map(current.map((row) => [row.id, row]))
      const next = rows.map((row) => {
        const old = previous.get(row.id)
        return old && shallowEqual(old, row) ? old : row
      })
      const unchanged = next.length === current.length && next.every((row, i) => row === current[i])
      return unchanged ? current : next
    })
    setCounts(queueCounts)
    setFailures(failed)
  }, [])

  useEffect(() => {
    void refresh()
    // One worker event per file would otherwise mean one full reload per file.
    const unsubscribe = window.api.ingest.onEvent(() => {
      if (pending.current) return
      pending.current = setTimeout(() => {
        pending.current = null
        void refresh()
      }, REFRESH_MS)
    })
    return () => {
      unsubscribe()
      if (pending.current) clearTimeout(pending.current)
    }
  }, [refresh])

  return { images, counts, failures, refresh }
}
