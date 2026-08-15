import { useCallback, useState } from 'react'
import type { ImageRow } from '../../shared/types.js'
import { GUTTER, ROW_GAP, TILE } from '../layout.js'
import { Tile } from './Tile.js'
import { TileMenu, type MenuTarget } from './TileMenu.js'

type Props = {
  images: ImageRow[]
  columns: number
  selectedId: number | null
  onSelect: (id: number) => void
  onChanged: () => void
}

/**
 * Deliberately not virtualised: plain DOM holds a 120Hz frame budget at 5000
 * tiles (measured upstream), and the page size caps the list at 500 anyway.
 */
export function Grid({ images, columns, selectedId, onSelect, onChanged }: Props) {
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  // Stable, or every memoised tile re-renders on each menu open.
  const onMenu = useCallback((target: MenuTarget) => setMenu(target), [])
  const close = useCallback(() => setMenu(null), [])

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, ${TILE}px)`,
        columnGap: GUTTER,
        rowGap: ROW_GAP
      }}
    >
      {/* onSelect passes through unwrapped so memoised tiles keep a stable prop. */}
      {images.map((image) => (
        <Tile
          key={image.id}
          image={image}
          selected={image.id === selectedId}
          menuOpen={menu?.id === image.id}
          onSelect={onSelect}
          onMenu={onMenu}
        />
      ))}

      {menu && (
        <>
          {/* Catches the click that dismisses the menu, including one that
              would otherwise select a different tile on the way past. */}
          <div className="menu-backdrop" onPointerDown={close} onContextMenu={close} />
          <TileMenu target={menu} onClose={close} onChanged={onChanged} />
        </>
      )}
    </div>
  )
}
