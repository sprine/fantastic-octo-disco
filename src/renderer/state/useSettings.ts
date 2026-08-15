import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type UiSettings } from '../../shared/settings.js'

/**
 * Column count and drawer state, persisted. The first paint uses defaults and
 * the stored values arrive one round trip later — a flicker rather than a
 * wrong answer; the alternative is a synchronous IPC call on the render path.
 */
export function useSettings(): {
  settings: UiSettings
  update: (patch: (current: UiSettings) => Partial<UiSettings>) => void
} {
  const [settings, setSettings] = useState<UiSettings>(DEFAULT_SETTINGS)
  const current = useRef(settings)
  const touched = useRef(false)

  useEffect(() => {
    void window.api.settings.get().then((stored) => {
      // Someone who dragged the divider inside the first round trip meant it;
      // the stored value arriving after would undo an action they just took.
      if (touched.current) return
      current.current = stored
      setSettings(stored)
    })
  }, [])

  // Stable, so the window-level key handler that toggles the drawer can be
  // registered once rather than reattached whenever a setting changes.
  const update = useCallback((patch: (value: UiSettings) => Partial<UiSettings>) => {
    const next = { ...current.current, ...patch(current.current) }
    // A divider drag proposes the same column count on every mouse move
    // between snap points, and each write is a flush to disk.
    const keys = Object.keys(next) as (keyof UiSettings)[]
    if (keys.every((key) => next[key] === current.current[key])) return

    touched.current = true
    current.current = next
    setSettings(next)
    // A failed write costs a setting, not the session — but an unhandled
    // rejection would be the only trace it left.
    window.api.settings.set(next).catch((error) => console.error('[settings] write failed', error))
  }, [])

  return { settings, update }
}
