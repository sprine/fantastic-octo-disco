import { memo, useEffect, useRef, useState } from 'react'
import type { ImageRow } from '../../shared/types.js'
import { imgUrl } from '../../shared/imgUrl.js'
import { basename } from '../format.js'

type Props = {
  image: ImageRow
  selected: boolean
  menuOpen: boolean
  onSelect: (id: number) => void
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
export const Tile = memo(function Tile({ image, selected, menuOpen, onSelect, onMenu }: Props) {
  const [broken, setBroken] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const name = basename(image.source_path)

  // Arrow traversal must not move the selection out of view.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      className={`tile${selected ? ' selected' : ''}${menuOpen ? ' targeted' : ''}`}
      onClick={() => onSelect(image.id)}
      onDoubleClick={() => window.api.shell.openOriginal(image.id)}
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
