import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { errorMessage } from '../../shared/errors.js'
import type { DeleteMode } from '../../shared/types.js'
import { menuPosition } from '../menu.js'

export type MenuTarget = { id: number; x: number; y: number }

type Props = { target: MenuTarget; onClose: () => void; onChanged: () => void }

/**
 * The same three actions the detail panel offers, on the tile itself. Drawn in
 * the renderer rather than popped native: a native menu is a second IPC
 * channel for no visible difference.
 *
 * No confirmation here: 'delete original' confirms in main, where the
 * guarantee belongs to the operation, and a second dialog would only teach the
 * user to click through the first.
 */
export function TileMenu({ target, onClose, onChanged }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ x: target.x, y: target.y })
  const [failed, setFailed] = useState<string | null>(null)

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

  // Held open rather than closed on failure: a menu that vanishes having
  // done nothing is indistinguishable from one that worked.
  const attempt = async (verb: string, action: () => Promise<unknown>, then?: () => void) => {
    setFailed(null)
    try {
      await action()
    } catch (error) {
      return setFailed(`Could not ${verb}: ${errorMessage(error)}`)
    }
    onClose()
    then?.()
  }

  const remove = (mode: DeleteMode) =>
    attempt('remove', () => window.api.library.remove([target.id], mode), onChanged)

  return (
    <div className="tile-menu" ref={ref} style={{ left: at.x, top: at.y }} role="menu">
      <button
        role="menuitem"
        onClick={() => attempt('open', () => window.api.shell.openOriginal(target.id))}
      >
        Open original
      </button>
      <button
        role="menuitem"
        onClick={() => attempt('show', () => window.api.shell.showInFolder(target.id))}
      >
        Show in folder
      </button>
      <button role="menuitem" onClick={() => remove('library')}>
        Remove from library
      </button>
      {/* Separated and last: the one irreversible action in the application. */}
      <hr />
      <button className="danger" role="menuitem" onClick={() => remove('original')}>
        Delete original
      </button>
      {failed && <p className="notice">{failed}</p>}
    </div>
  )
}
