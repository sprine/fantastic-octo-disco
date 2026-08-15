import { memo, useEffect, useRef, useState } from 'react'
import type { ImageRow } from '../../shared/types.js'
import { imgUrl } from '../../shared/imgUrl.js'
import { basename } from '../format.js'

type Props = {
  image: ImageRow
  /** In the selection; there may be many. */
  selected: boolean
  /** The one tile arrow keys move — only it may scroll itself into view. */
  focused: boolean
  menuOpen: boolean
  onSelect: (id: number, shift: boolean) => void
  onMenu: (target: { id: number; x: number; y: number }) => void
}

/**
 * Square tile, image contained rather than cropped. A missing derivative gets
 * a 404 from img:// and falls back to the filename, which keeps a broken
 * derivative from reading as a missing image.
 *
 * Memoised because an arrow keypress re-renders the grid, and re-running
 * every tile body to flip one boolean is the wrong cost at library scale.
 */
export const Tile = memo(function Tile({ image, selected, focused, menuOpen, onSelect, onMenu }: Props) {
  const [broken, setBroken] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const name = basename(image.source_path)

  // Arrow traversal must not move the focus out of view. Keyed on focus, not
  // selection: a shift-click selects hundreds of tiles at once, and each one
  // scrolling itself "into view" would fight over the scroll position.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  return (
    <button
      ref={ref}
      className={`tile${selected ? ' selected' : ''}${menuOpen ? ' targeted' : ''}`}
      onClick={(event) => onSelect(image.id, event.shiftKey)}
      onDoubleClick={() =>
        // The viewer and menus own the visible notice; from a tile the drift
        // badge is the signal, so a failure here is only logged.
        window.api.shell.openOriginal(image.id).catch((error) => console.error('[open]', error))
      }
      // The tile marks itself while the menu is open, so a delete can never be
      // aimed at a tile the user is not looking at.
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu({ id: image.id, x: event.clientX, y: event.clientY })
      }}
      title={`${name}\nDouble-click to open the original`}
    >
      {broken ? (
        <span className="tile-placeholder">{name}</span>
      ) : (
        // Lazy: mounting the grid would otherwise fire one img:// request per
        // row at once for a dozen tiles' worth of visible pixels.
        <img src={imgUrl(image.id, 'thumb')} alt={name} loading="lazy" onError={() => setBroken(true)} />
      )}
      {image.drift !== 'fresh' && <span className={`badge ${image.drift}`}>{image.drift}</span>}
    </button>
  )
})
