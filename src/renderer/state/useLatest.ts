import { useRef } from 'react'

/**
 * The latest value in an identity-stable box, so a callback registered once
 * (window listeners, memoised props) reads fresh state without being minted
 * anew on every change. The render-phase ref write lives here, audited once,
 * instead of being hand-rolled per caller.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}
