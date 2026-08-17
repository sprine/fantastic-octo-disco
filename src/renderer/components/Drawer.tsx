import { useEffect, useRef, type ReactNode } from 'react'
import { drawerWidth, nearestColumns } from '../layout.js'

type Props = {
  columns: number
  onColumns: (columns: number) => void
  onClose: () => void
  children: ReactNode
}

/**
 * A layout shell: header, whatever App composes inside, and the divider. The
 * grid, group bar and footer take their props from App directly rather than
 * transiting an ever-growing pass-through Props type here.
 */
export function Drawer({ columns, onColumns, onClose, children }: Props) {
  const dragging = useRef(false)

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
    <aside className="drawer" style={{ width: drawerWidth(columns) }}>
      <header className="drawer-header">
        <h1>Image Library &amp; Display</h1>
        <button className="icon" onClick={onClose} title="Close drawer ([d])">
          ×
        </button>
      </header>

      {children}

      <div
        className="divider"
        onMouseDown={() => (dragging.current = true)}
        role="separator"
        aria-orientation="vertical"
      />
    </aside>
  )
}
