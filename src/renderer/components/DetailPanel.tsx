import { memo } from 'react'
import { readMetadata, type ImageMetadata, type ImageRow } from '../../shared/types.js'
import { IMAGE_ACTIONS, useAttempt } from '../actions.js'
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
      title: 'Camera',
      fields: compact([
        ['Camera', cameraName(meta)],
        ['Lens', meta.lens],
        ['Exposure', exposure(meta.exposureSeconds)],
        ['Aperture', meta.fNumber === undefined ? null : `f/${trimmed(meta.fNumber)}`],
        ['ISO', meta.iso === undefined ? null : String(meta.iso)],
        ['Focal length', meta.focalLengthMm === undefined ? null : `${trimmed(meta.focalLengthMm)} mm`]
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
  // The import-time fallback says nothing the row below does not: it already says when.
  if (image.captured_at === null || meta.captureSource === 'import') return ['Captured', null]
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

/** Most models already carry the make ("Canon EOS 5D"); don't say it twice. */
function cameraName(meta: ImageMetadata): string | null {
  const { make, model } = meta
  if (!model) return make ?? null
  if (!make || model.toLowerCase().startsWith(make.toLowerCase())) return model
  return `${make} ${model}`
}

/** The photographer's notation: 1/250 s below a second, plain seconds above. */
function exposure(seconds: number | undefined): string | null {
  if (seconds === undefined) return null
  if (seconds >= 1) return `${trimmed(seconds)} s`
  return `1/${Math.round(1 / seconds)} s`
}

/** Up to one decimal, with a trailing .0 dropped: f/1.8 but f/8, 24 mm not 24.0 mm. */
const trimmed = (value: number): string => String(Math.round(value * 10) / 10)

const degrees = (value: number | undefined): string | null =>
  value === undefined ? null : `${value.toFixed(6)}°`

const local = (at: number): string => new Date(at).toLocaleString()

function compact(pairs: Field[]): { label: string; value: string }[] {
  return pairs.filter(([, value]) => !!value).map(([label, value]) => ({ label, value: value! }))
}

// Memoised: the viewer re-renders per pointer event while panning, and both
// props are identity-stable — without this every pan tick re-parses metadata_json.
export const DetailPanel = memo(function DetailPanel({
  image,
  onChanged
}: {
  image: ImageRow
  onChanged: () => void
}) {
  const { failed, attempt } = useAttempt(onChanged)

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

      <div className="detail-actions">
        {IMAGE_ACTIONS.map((action) => (
          <button
            key={action.label}
            className={action.danger ? 'danger' : undefined}
            onClick={() => attempt(action, image.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
})
