import { Fragment, useCallback, useState } from 'react'
import type { ImageRow } from '../../shared/types.js'
import type { Grouped } from '../groups.js'
import { GUTTER, ROW_GAP, TILE } from '../layout.js'
import { Tile } from './Tile.js'
import { TileMenu, type MenuTarget } from './TileMenu.js'

type Props = {
  images: ImageRow[]
  /** Grouped in App, where the flat draw order is derived from the same pass. */
  grouped: Grouped[] | null
  columns: number
  selectedIds: ReadonlySet<number>
  focusedId: number | null
  onSelect: (id: number, shift: boolean) => void
  onChanged: () => void
}

/**
 * Deliberately not virtualised: plain DOM holds a 120Hz frame budget at 5000
 * tiles (measured upstream), and the page size caps the list at 500 anyway.
 */
export function Grid({ images, grouped, columns, selectedIds, focusedId, onSelect, onChanged }: Props) {
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  const close = useCallback(() => setMenu(null), [])

  // onSelect and setMenu pass through unwrapped: both are stable, and a fresh
  // callback here re-renders every memoised tile.
  const tile = (image: ImageRow) => (
    <Tile
      key={image.id}
      image={image}
      selected={selectedIds.has(image.id)}
      focused={image.id === focusedId}
      menuOpen={menu?.id === image.id}
      onSelect={onSelect}
      onMenu={setMenu}
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
      {grouped === null
        ? images.map(tile)
        : grouped.map((group) => (
            <Fragment key={group.value}>
              <div className="group-label">
                {group.value} <em>{group.images.length}</em>
              </div>
              {group.images.map(tile)}
            </Fragment>
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
