import { useEffect, useRef } from 'react'
import type { Failures, ImageRow, QueueCounts } from '../../shared/types.js'
import { drawerWidth, nearestColumns } from '../layout.js'
import { Grid } from './Grid.js'
import { ImportFooter } from './ImportFooter.js'

type Props = {
  images: ImageRow[]
  counts: QueueCounts
  failures: Failures
  columns: number
  selectedId: number | null
  onSelect: (id: number) => void
  onColumns: (columns: number) => void
  onClose: () => void
  onChanged: () => void
}

export function Drawer(props: Props) {
  const dragging = useRef(false)
  // Depend on the one callback, not the whole props object, or the drag
  // listeners are torn down and reattached on every unrelated re-render.
  const { onColumns } = props

  useEffect(() => {
    // A mouseup released outside the window never arrives, so trust buttons
    // over the flag: otherwise the divider keeps dragging after you let go.
    const onMove = (event: MouseEvent) => {
      if (!dragging.current) return
      if (event.buttons === 0) return void (dragging.current = false)
      onColumns(nearestColumns(event.clientX))
    }
    const onUp = () => (dragging.current = false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onColumns])

  return (
    <aside className="drawer" style={{ width: drawerWidth(props.columns) }}>
      <header className="drawer-header">
        <h1>Image Library &amp; Display</h1>
        <button className="icon" onClick={props.onClose} title="Close drawer ([d])">
          ×
        </button>
      </header>

      <Grid
        images={props.images}
        columns={props.columns}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        onChanged={props.onChanged}
      />

      <ImportFooter counts={props.counts} failures={props.failures} onChanged={props.onChanged} />

      <div
        className="divider"
        onMouseDown={() => (dragging.current = true)}
        role="separator"
        aria-orientation="vertical"
      />
    </aside>
  )
}
