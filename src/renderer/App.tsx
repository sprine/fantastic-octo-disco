import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from './components/Drawer.js'
import { applyFilters, groupImages, type Filters, type GroupKey } from './groups.js'
import { Rail } from './components/Rail.js'
import { Viewer } from './components/Viewer.js'
import { useLibrary } from './state/useLibrary.js'
import { useSettings } from './state/useSettings.js'

export function App() {
  const { images, counts, failures, refresh } = useLibrary()
  const { settings, update } = useSettings()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  // Session state, deliberately unpersisted: a grouping is a question being
  // asked now, not how the library lives.
  const [groupBy, setGroupBy] = useState<GroupKey | null>(null)
  const [filters, setFilters] = useState<Filters>({})

  // What the grid draws, in the order it draws it — grouped sections reorder
  // the flat list, and arrow traversal must follow the eye, not the database.
  const visible = useMemo(() => {
    const filtered = applyFilters(images, filters)
    return groupBy ? groupImages(filtered, groupBy).flatMap((group) => group.images) : filtered
  }, [images, filters, groupBy])

  // Looked up in the full library, so a selection filtered out of the grid
  // keeps its viewer rather than vanishing mid-thought.
  const selected = images.find((image) => image.id === selectedId) ?? null

  // Stable so the divider's drag listeners survive unrelated re-renders.
  const onColumns = useCallback((columns: number) => update(() => ({ columns })), [update])

  // Selection and displayed image are one value, so traversal is an index
  // move over the same ordered list the grid renders.
  const step = useCallback(
    (delta: number) => {
      if (visible.length === 0) return
      const current = visible.findIndex((image) => image.id === selectedId)
      const next = current === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, current + delta))
      setSelectedId(visible[next]!.id)
    },
    [visible, selectedId]
  )

  // The handler reads the latest step through a ref, so the window listener is
  // registered once instead of reattached on every arrow press — the one key
  // people hold down.
  const stepRef = useRef(step)
  stepRef.current = step

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Auto-repeat is not a second press: held down, [d] would flip the
      // drawer thirty times a second, each flip a synchronous fsync in main.
      if (event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return

      switch (event.key.length === 1 ? event.key.toLowerCase() : event.key) {
        case 'Escape':
          return setSelectedId(null)
        case 'm':
          return setDetailOpen((open) => !open)
        case 'd':
          return update((value) => ({ drawerOpen: !value.drawerOpen }))
        case 'ArrowRight':
          return stepRef.current(1)
        case 'ArrowLeft':
          return stepRef.current(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [update])

  // Drop anywhere, per the mockup's annotation.
  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()
      const paths = window.api.files.pathsFor(Array.from(event.dataTransfer.files))
      if (!paths.length) return
      try {
        await window.api.ingest.addPaths(paths)
      } catch (error) {
        // An import interrupted by quit rejects here; an unhandled rejection
        // would be the only trace.
        console.error('[import] failed', error)
      }
      await refresh()
    },
    [refresh]
  )

  return (
    <div className="app" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      {settings.drawerOpen ? (
        <Drawer
          images={images}
          visible={visible}
          counts={counts}
          failures={failures}
          columns={settings.columns}
          groupBy={groupBy}
          filters={filters}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onColumns={onColumns}
          onGroupBy={setGroupBy}
          onFilters={setFilters}
          onClose={() => update(() => ({ drawerOpen: false }))}
          onChanged={refresh}
        />
      ) : (
        <Rail onOpen={() => update(() => ({ drawerOpen: true }))} count={images.length} />
      )}
      <Viewer
        image={selected}
        detailOpen={detailOpen}
        onToggleDetail={() => setDetailOpen((open) => !open)}
        onClose={() => setSelectedId(null)}
        onChanged={refresh}
        libraryEmpty={images.length === 0}
      />
    </div>
  )
}
