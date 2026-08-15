import { useCallback, useState } from 'react'
import type { ImageRow } from '../../shared/types.js'
import { groupImages, type GroupKey } from '../groups.js'
import { GUTTER, ROW_GAP, TILE } from '../layout.js'
import { Tile } from './Tile.js'
import { TileMenu, type MenuTarget } from './TileMenu.js'

type Props = {
  images: ImageRow[]
  columns: number
  groupBy: GroupKey | null
  selectedIds: ReadonlySet<number>
  focusedId: number | null
  onSelect: (id: number, shift: boolean) => void
  onChanged: () => void
}

/**
 * Deliberately not virtualised: plain DOM holds a 120Hz frame budget at 5000
 * tiles (measured upstream), and the page size caps the list at 500 anyway.
 */
export function Grid({ images, columns, groupBy, selectedIds, focusedId, onSelect, onChanged }: Props) {
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  // Stable, or every memoised tile re-renders on each menu open.
  const onMenu = useCallback((target: MenuTarget) => setMenu(target), [])
  const close = useCallback(() => setMenu(null), [])

  const tile = (image: ImageRow) => (
    <Tile
      key={image.id}
      image={image}
      selected={selectedIds.has(image.id)}
      focused={image.id === focusedId}
      menuOpen={menu?.id === image.id}
      onSelect={onSelect}
      onMenu={onMenu}
    />
  )

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
      {groupBy === null
        ? images.map(tile)
        : groupImages(images, groupBy).map((group) => (
            <div key={group.value} className="grid-section" style={{ display: 'contents' }}>
              <div className="group-label">
                {group.value} <em>{group.images.length}</em>
              </div>
              {group.images.map(tile)}
            </div>
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
