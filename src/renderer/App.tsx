import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from './components/Drawer.js'
import { applyFilters, groupImages, type Filters, type GroupKey } from './groups.js'
import { Rail } from './components/Rail.js'
import { Viewer } from './components/Viewer.js'
import { extendTo, NO_SELECTION, selectOne, type Selection } from './selection.js'
import type { DeleteMode } from '../shared/types.js'
import { useLibrary } from './state/useLibrary.js'
import { useSettings } from './state/useSettings.js'
import { clamp } from './zoom.js'

export function App() {
  const { images, counts, failures, refresh } = useLibrary()
  const { settings, update } = useSettings()
  // The focused image (viewer) and the multi-selection are separate values:
  // a shift-click grows the set but the viewer still shows one image.
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [detailOpen, setDetailOpen] = useState(false)
  // Session state, deliberately unpersisted: a grouping is a question being
  // asked now, not how the library lives.
  const [groupBy, setGroupBy] = useState<GroupKey | null>(null)
  const [filters, setFilters] = useState<Filters>({})

  // The grid's sections and the flat order it draws them in, derived together
  // so the bucketing runs once: grouped sections reorder the flat list, and
  // arrow traversal must follow the eye, not the database.
  const { grouped, visible } = useMemo(() => {
    const filtered = applyFilters(images, filters)
    if (!groupBy) return { grouped: null, visible: filtered }
    const sections = groupImages(filtered, groupBy)
    return { grouped: sections, visible: sections.flatMap((group) => group.images) }
  }, [images, filters, groupBy])

  // Looked up in the full library, so a selection filtered out of the grid
  // keeps its viewer rather than vanishing mid-thought.
  const selected = images.find((image) => image.id === selectedId) ?? null

  // Stable so the divider's drag listeners survive unrelated re-renders.
  const onColumns = useCallback((columns: number) => update(() => ({ columns })), [update])

  const onSelect = useCallback(
    (id: number, shift: boolean) => {
      setSelection((prev) =>
        shift ? extendTo(prev, visible.map((image) => image.id), id) : selectOne(id)
      )
      setSelectedId(id)
    },
    [visible]
  )

  // Traversal is an index move over the same ordered list the grid renders.
  // It collapses the multi-selection: an arrow press means "this one now".
  const step = useCallback(
    (delta: number) => {
      if (visible.length === 0) return
      const current = visible.findIndex((image) => image.id === selectedId)
      const next = current === -1 ? 0 : clamp(current + delta, 0, visible.length - 1)
      setSelectedId(visible[next]!.id)
      setSelection(selectOne(visible[next]!.id))
    },
    [visible, selectedId]
  )

  // Delete removes the selection from the library; ⌘-delete trashes the
  // originals too. Both go through one IPC call so main confirms once per
  // batch, and 0 back means the confirmation was cancelled — keep the
  // selection so the user is not made to rebuild it.
  const removeSelected = useCallback(
    async (mode: DeleteMode) => {
      const ids = selection.ids.size > 0 ? [...selection.ids] : selectedId !== null ? [selectedId] : []
      if (ids.length === 0) return
      try {
        if ((await window.api.library.remove(ids, mode)) === 0) return
      } catch (error) {
        // A partial failure: rows that would not trash stay in the grid after
        // refresh — that is the visible signal; the detail lands here.
        console.error('[remove]', error)
      }
      setSelection(NO_SELECTION)
      setSelectedId(null)
      await refresh()
    },
    [selection, selectedId, refresh]
  )

  // The handler reads the latest step/remove through refs, so the window
  // listener is registered once instead of reattached on every arrow press —
  // the one key people hold down.
  const stepRef = useRef(step)
  stepRef.current = step
  const removeRef = useRef(removeSelected)
  removeRef.current = removeSelected

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Auto-repeat is not a second press: held down, [d] would flip the
      // drawer thirty times a second, each flip a synchronous fsync in main.
      if (event.repeat || event.isComposing) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return

      // Before the modifier guard: ⌘ is what upgrades delete to the original.
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (event.ctrlKey || event.altKey) return
        event.preventDefault()
        return void removeRef.current(event.metaKey ? 'original' : 'library')
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      switch (event.key.length === 1 ? event.key.toLowerCase() : event.key) {
        case 'Escape':
          setSelectedId(null)
          return setSelection(NO_SELECTION)
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
          grouped={grouped}
          counts={counts}
          failures={failures}
          columns={settings.columns}
          groupBy={groupBy}
          filters={filters}
          selectedIds={selection.ids}
          focusedId={selectedId}
          onSelect={onSelect}
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
