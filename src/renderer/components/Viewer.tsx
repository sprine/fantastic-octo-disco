import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageRow } from '../../shared/types.js'
import { imgUrl } from '../../shared/imgUrl.js'
import { upscaleCeiling } from '../resolution.js'
import { clampPan, FIT, wheelFactor, wheelPixels, zoomAt, ZOOM_STEP, type View } from '../zoom.js'
import { DetailPanel } from './DetailPanel.js'
import { EmptyState } from './EmptyState.js'

type Props = {
  image: ImageRow | null
  detailOpen: boolean
  onToggleDetail: () => void
  onClose: () => void
  onChanged: () => void
  libraryEmpty: boolean
}

export function Viewer({ image, detailOpen, onToggleDetail, onClose, onChanged, libraryEmpty }: Props) {
  const [view, setView] = useState<View>(FIT)
  const [broken, setBroken] = useState(false)
  const [ceiling, setCeiling] = useState<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Every image opens fitted; a lazy drift check runs on the one you are
  // actually looking at.
  useEffect(() => {
    setView(FIT)
    setBroken(false)
    if (image) void window.api.library.check(image.id)
  }, [image?.id])

  /**
   * Pan is clamped against the drawn size, so every change asks the DOM how
   * big the image currently is. Reading rather than storing keeps one source
   * of truth: the layout, which a window resize changes without telling React.
   */
  const settle = useCallback((next: View): View => {
    const stage = stageRef.current
    const drawn = imgRef.current
    if (!stage || !drawn) return next
    const content = { width: drawn.offsetWidth, height: drawn.offsetHeight }
    const viewport = { width: stage.clientWidth, height: stage.clientHeight }
    return { scale: next.scale, pan: clampPan(next.pan, next.scale, content, viewport) }
  }, [])

  /** Anchored on a point in stage coordinates measured from the centre. */
  const zoom = useCallback(
    (factor: number, anchor = { x: 0, y: 0 }) =>
      setView((current) => settle(zoomAt(current, factor, anchor))),
    [settle]
  )

  // The window can change the ceiling without the image changing: a narrower
  // stage fits the derivative smaller, which raises the zoom at which
  // enlargement starts.
  const measure = useCallback(() => {
    const drawn = imgRef.current
    if (!drawn) return setCeiling(null)
    setCeiling(upscaleCeiling(drawn.naturalWidth, drawn.offsetWidth, window.devicePixelRatio))
  }, [])

  useEffect(() => {
    measure()
    const stage = stageRef.current
    if (!stage) return
    // The window is not the only thing that resizes the stage: toggling the
    // drawer or dragging the divider does it without a resize event, leaving
    // an edge-panned image stranded past its new slack.
    const observer = new ResizeObserver(() => {
      measure()
      setView(settle)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [measure, settle, image?.id, broken])

  /**
   * Registered by hand because React attaches `wheel` passively at the root,
   * and a passive listener cannot stop the browser acting on the gesture. A
   * trackpad pinch arrives as a wheel event with ctrlKey set — the only form
   * the web platform reports.
   */
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = stage.getBoundingClientRect()
      zoom(wheelFactor(wheelPixels(event.deltaY, event.deltaMode)), {
        x: event.clientX - (box.left + box.width / 2),
        y: event.clientY - (box.top + box.height / 2)
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
    // The stage does not exist while the pane is empty, so this runs again
    // when an image arrives rather than once on mount.
  }, [zoom, image?.id])

  // Pointer capture rather than window listeners: a drag that leaves the
  // stage, or ends outside the window, still arrives here.
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const held = drag.current
    if (!held || held.id !== event.pointerId) return
    const dx = event.clientX - held.x
    const dy = event.clientY - held.y
    drag.current = { id: held.id, x: event.clientX, y: event.clientY }
    setView((current) =>
      settle({ scale: current.scale, pan: { x: current.pan.x + dx, y: current.pan.y + dy } })
    )
  }

  const endDrag = (event: React.PointerEvent) => {
    if (drag.current?.id === event.pointerId) drag.current = null
  }

  if (!image) {
    return (
      <main className="viewer">
        <EmptyState libraryEmpty={libraryEmpty} />
      </main>
    )
  }

  const upscaled = ceiling !== null && view.scale > ceiling

  return (
    <main className="viewer">
      <div
        className={`stage${view.scale > 1 ? ' pannable' : ''}`}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // Past the ceiling, the only route to more detail.
        onDoubleClick={() => window.api.shell.openOriginal(image.id)}
      >
        {broken ? (
          <p className="stage-placeholder">
            No display copy for this image: its derivative is missing.
            Double-click to open the original.
          </p>
        ) : (
          <img
            ref={imgRef}
            src={imgUrl(image.id, 'display')}
            alt=""
            draggable={false}
            style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.scale})` }}
            onLoad={measure}
            onError={() => setBroken(true)}
          />
        )}
      </div>

      <button className="pill top-left" onClick={onToggleDetail}>
        [m] metadata
      </button>
      <button className="pill top-right" onClick={onClose}>
        [esc] close
      </button>

      {/* Bottom right, away from the detail panel's destructive actions in the
          opposite corner. */}
      <div className="pill bottom-right zoom">
        <button onClick={() => zoom(1 / ZOOM_STEP)} title="Zoom out">
          -
        </button>
        <button className="zoom-level" onClick={() => setView(FIT)} title="Fit to the window">
          zoom {Math.round(view.scale * 100)}%
        </button>
        <button onClick={() => zoom(ZOOM_STEP)} title="Zoom in">
          +
        </button>
      </div>

      {upscaled && (
        <p className="ceiling">Enlarged beyond the stored pixels. Double-click for the original.</p>
      )}

      {detailOpen && <DetailPanel image={image} onChanged={onChanged} />}
    </main>
  )
}
