import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAttempt } from './actions.js'
import { Drawer } from './components/Drawer.js'
import { GroupBar } from './components/GroupBar.js'
import { Grid } from './components/Grid.js'
import { ImportFooter } from './components/ImportFooter.js'
import { applyFilters, groupImages, type Filters, type GroupKey } from './groups.js'
import { Rail } from './components/Rail.js'
import { Viewer } from './components/Viewer.js'
import { extendTo, NO_SELECTION, selectOne, type Selection } from './selection.js'
import type { DeleteMode } from '../shared/types.js'
import { useLatest } from './state/useLatest.js'
import { useLibrary } from './state/useLibrary.js'
import { useSettings } from './state/useSettings.js'
import { clamp } from './zoom.js'

export function App() {
  const { images, counts, failures, refresh } = useLibrary()
  const { settings, update } = useSettings()
  // One attempt for every ingest mutation — the footer's buttons and the drop
  // target below share it, so a failed drop reports where a failed click does.
  const { failed: importFailed, run: runImport } = useAttempt(refresh)
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

  // Reads `visible` through a ref: keyed on it, every refresh during an import
  // would mint a new onSelect and re-render all 500 memoised tiles — the exact
  // churn useLibrary's row reconciliation exists to prevent.
  const visibleRef = useLatest(visible)
  const onSelect = useCallback((id: number, shift: boolean) => {
    setSelection((prev) =>
      shift ? extendTo(prev, visibleRef.current.map((image) => image.id), id) : selectOne(id)
    )
    setSelectedId(id)
  }, [])

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
      const ids = [...selection.ids]
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
    [selection, refresh]
  )

  // The handler reads the latest step/remove through refs, so the window
  // listener is registered once instead of reattached on every arrow press —
  // the one key people hold down.
  const stepRef = useLatest(step)
  const removeRef = useLatest(removeSelected)

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
      const ok = await runImport('import', () => window.api.ingest.addPaths(paths), true)
      // The notice renders in the footer, which only exists inside the drawer:
      // a failed drop with the drawer closed must open it, or it reports nowhere.
      if (!ok) update(() => ({ drawerOpen: true }))
    },
    [runImport, update]
  )

  return (
    <div className="app" onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      {settings.drawerOpen ? (
        <Drawer
          columns={settings.columns}
          onColumns={onColumns}
          onClose={() => update(() => ({ drawerOpen: false }))}
        >
          {/* Secondary by design: hidden until there is a library worth slicing. */}
          {images.length > 1 && (
            <GroupBar
              images={images}
              groupBy={groupBy}
              filters={filters}
              onGroupBy={setGroupBy}
              onFilters={setFilters}
            />
          )}
          <Grid
            images={visible}
            grouped={grouped}
            columns={settings.columns}
            selectedIds={selection.ids}
            focusedId={selectedId}
            onSelect={onSelect}
            onChanged={refresh}
          />
          <ImportFooter counts={counts} failures={failures} failed={importFailed} run={runImport} />
        </Drawer>
      ) : (
        <Rail onOpen={() => update(() => ({ drawerOpen: true }))} count={images.length} />
      )}
      <Viewer
        image={selected}
        detailOpen={detailOpen}
        onToggleDetail={() => setDetailOpen((open) => !open)}
        onChanged={refresh}
        libraryEmpty={images.length === 0}
      />
    </div>
  )
}
