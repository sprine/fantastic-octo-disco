/**
 * Flat objects only — one level of === is a complete equality check for the
 * rows and settings this state layer holds. Key counts are compared first so
 * a key present on one side alone reads as different, not skipped.
 */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}
