import type { ImageRow } from '../../shared/types.js'
import { facets, GROUP_KEYS, GROUP_LABELS, type Filters, type GroupKey } from '../groups.js'

type Props = {
  images: ImageRow[]
  groupBy: GroupKey | null
  filters: Filters
  onGroupBy: (key: GroupKey | null) => void
  onFilters: (filters: Filters) => void
}

/**
 * One 11px line of dimensions; the open one unfolds its value chips beneath.
 * Clicking a chip filters; every other dimension's counts follow (the
 * cross-filter lives in groups.ts). Secondary chrome on purpose: it has to
 * earn no attention until the library is big enough to need it.
 */
export function GroupBar({ images, groupBy, filters, onGroupBy, onFilters }: Props) {
  const filtered = GROUP_KEYS.some((key) => filters[key])

  const toggleChip = (key: GroupKey, value: string) => {
    const next = { ...filters }
    if (next[key] === value) delete next[key]
    else next[key] = value
    onFilters(next)
  }

  return (
    <div className="group-bar">
      <div className="group-dimensions">
        {GROUP_KEYS.map((key) => (
          <button
            key={key}
            className={`${groupBy === key ? 'active' : ''}${filters[key] ? ' filtered' : ''}`}
            onClick={() => onGroupBy(groupBy === key ? null : key)}
            title={`Group by ${GROUP_LABELS[key]}`}
          >
            {GROUP_LABELS[key]}
          </button>
        ))}
        {filtered && (
          <button className="clear" onClick={() => onFilters({})} title="Clear all filters">
            clear
          </button>
        )}
      </div>

      {groupBy && (
        <div className="group-chips">
          {facets(images, filters, groupBy).map(({ value, count }) => (
            <button
              key={value}
              className={`chip${filters[groupBy] === value ? ' active' : ''}`}
              onClick={() => toggleChip(groupBy, value)}
            >
              {value} <em>{count}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
