import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IMAGE_ACTIONS, useAttempt } from '../actions.js'
import { menuPosition } from '../menu.js'

export type MenuTarget = { id: number; x: number; y: number }

type Props = { target: MenuTarget; onClose: () => void; onChanged: () => void }

/**
 * The same actions the detail panel offers (IMAGE_ACTIONS), on the tile itself.
 * Drawn in the renderer rather than popped native: a native menu is a second
 * IPC channel for no visible difference.
 */
export function TileMenu({ target, onClose, onChanged }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ x: target.x, y: target.y })
  // Held open rather than closed on failure: a menu that vanishes having done
  // nothing is indistinguishable from one that worked.
  const [failed, attempt] = useAttempt(onChanged, onClose)

  // Before paint, from the menu's own measured size: the labels are prose and
  // a font the window does not have changes them.
  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    setAt(
      menuPosition(
        { x: target.x, y: target.y },
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
    // `failed` is a dep because the notice grows the menu downward, and a menu
    // already at the bottom edge would push it off screen.
  }, [target, failed])

  useEffect(() => {
    // Capture and immediate: escape must close the menu and nothing else, and
    // the window handler that clears the displayed image sits on the same node.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      onClose()
    }
    const dismiss = () => onClose()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', dismiss)
    // Scroll the grid and the tile the menu names moves out from under it.
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [onClose])

  return (
    <div className="tile-menu" ref={ref} style={{ left: at.x, top: at.y }} role="menu">
      {IMAGE_ACTIONS.map((action) => (
        <Fragment key={action.label}>
          {/* Separated and last: the one irreversible action in the application. */}
          {action.danger && <hr />}
          <button
            className={action.danger ? 'danger' : undefined}
            role="menuitem"
            onClick={() => attempt(action, target.id)}
          >
            {action.label}
          </button>
        </Fragment>
      ))}
      {failed && <p className="notice">{failed}</p>}
    </div>
  )
}
