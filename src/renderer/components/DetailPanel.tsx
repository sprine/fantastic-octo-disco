import { useState } from 'react'
import { readMetadata, type DeleteMode, type ImageMetadata, type ImageRow } from '../../shared/types.js'
import { errorMessage } from '../../shared/errors.js'
import { basename, megabytes } from '../format.js'
import { displayCeiling } from '../resolution.js'

type DetailGroup = { title: string; fields: { label: string; value: string }[] }
type Field = [string, string | null | undefined]

/**
 * Read-only. Groups with nothing in them do not render, so a stripped PNG
 * shows a short honest panel instead of a column of dashes.
 */
export function buildGroups(image: ImageRow): DetailGroup[] {
  const meta = readMetadata(image.metadata_json)
  const groups: DetailGroup[] = [
    {
      title: 'File',
      fields: compact([
        ['Filename', basename(image.source_path)],
        ['Path', image.source_path],
        ['Size', image.bytes === null ? null : megabytes(image.bytes)],
        ['Status', image.drift === 'fresh' ? null : image.drift]
      ])
    },
    {
      title: 'Image',
      fields: compact([
        ['Dimensions', image.width && image.height ? `${image.width} x ${image.height}` : null],
        // Directly under the original's dimensions, where the two read against
        // each other: what the viewer shows is a reduced copy.
        ['Displayed', displayCeiling(image)],
        ['Resolution', meta.dpi === undefined ? null : `${meta.dpi} dpi`],
        ['Format', image.format?.toUpperCase()]
      ])
    },
    {
      title: 'Capture',
      fields: compact([captureField(image, meta), ['Imported', local(image.imported_at)]])
    },
    { title: 'Location', fields: compact(locationFields(meta)) }
  ]
  return groups.filter((group) => group.fields.length > 0)
}

/**
 * The panel says which fallback answered: a file date labelled "Captured" is
 * the fallback wearing the real thing's name. EXIF is a wall clock read as
 * UTC, so it renders back in UTC — the camera's own time. A file date is a
 * real instant and belongs in local time.
 */
function captureField(image: ImageRow, meta: ImageMetadata): Field {
  if (image.captured_at === null) return ['Captured', null]
  // The import-time fallback: the row below already says when.
  if (meta.captureSource === 'import') return ['Captured', null]
  if (meta.captureSource !== 'exif') return ['File date', local(image.captured_at)]
  return ['Captured', new Date(image.captured_at).toLocaleString(undefined, { timeZone: 'UTC' })]
}

/**
 * Decimal degrees: one number per axis, it pastes straight into a map. Six
 * places is what the tag can hold, not a claim about the fix.
 */
function locationFields(meta: ImageMetadata): Field[] {
  const fields: Field[] = [
    ['Latitude', degrees(meta.latitude)],
    ['Longitude', degrees(meta.longitude)]
  ]
  // The one depth ordinary EXIF can state: an altitude marked below sea level.
  if (meta.altitudeMetres !== undefined) {
    const below = meta.altitudeMetres < 0
    fields.push([below ? 'Depth' : 'Elevation', `${Math.abs(meta.altitudeMetres).toFixed(1)} m`])
  }
  return fields
}

const degrees = (value: number | undefined): string | null =>
  value === undefined ? null : `${value.toFixed(6)}°`

const local = (at: number): string => new Date(at).toLocaleString()

function compact(pairs: Field[]): { label: string; value: string }[] {
  return pairs.filter(([, value]) => !!value).map(([label, value]) => ({ label, value: value! }))
}

export function DetailPanel({ image, onChanged }: { image: ImageRow; onChanged: () => void }) {
  const [failed, setFailed] = useState<string | null>(null)

  // Every action reports its failure here: a silent catch reads to the user
  // as the button doing nothing, which is the bug this notice exists to end.
  const attempt = async (verb: string, action: () => Promise<unknown>, then?: () => void) => {
    setFailed(null)
    try {
      await action()
    } catch (error) {
      return setFailed(`Could not ${verb}: ${errorMessage(error)}`)
    }
    then?.()
  }

  // No confirmation here: 'original' confirms in main, and removeImage
  // rethrows when trashing fails.
  const remove = (mode: DeleteMode) =>
    attempt('remove', () => window.api.library.remove(image.id, mode), onChanged)

  return (
    <div className="detail">
      {buildGroups(image).map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <dl>
            {group.fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd title={field.value}>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {failed && <p className="notice">{failed}</p>}

      {/* Two commands one word apart: naming carries the safety margin. */}
      <div className="detail-actions">
        <button onClick={() => attempt('open', () => window.api.shell.openOriginal(image.id))}>
          Open original
        </button>
        <button onClick={() => attempt('show', () => window.api.shell.showInFolder(image.id))}>
          Show in folder
        </button>
        <button onClick={() => remove('library')}>Remove from library</button>
        <button className="danger" onClick={() => remove('original')}>
          Delete original
        </button>
      </div>
    </div>
  )
}
