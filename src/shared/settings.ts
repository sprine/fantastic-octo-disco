/**
 * What the interface remembers between launches: how wide the drawer is (as a
 * column count) and whether it is open. Deliberately small — session state
 * like selection and zoom resets with the session.
 */
export type UiSettings = {
  columns: number
  drawerOpen: boolean
}

/** Also the allowlist a stored column count is checked against. */
export const COLUMN_SNAPS = [1, 2, 3, 4] as const

/** The mockup draws two columns with the drawer open; a first launch matches it. */
export const DEFAULT_SETTINGS: UiSettings = {
  columns: 2,
  drawerOpen: true
}

/**
 * Field by field rather than all-or-nothing: a settings file that lost one
 * value to a truncated write should cost that one setting, not the rest. A
 * column count off the snap list would leave the drawer a width the divider
 * cannot drag back.
 */
export function sanitiseSettings(raw: unknown): UiSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const value = raw as Record<string, unknown>
  return {
    columns: COLUMN_SNAPS.some((snap) => snap === value.columns)
      ? (value.columns as number)
      : DEFAULT_SETTINGS.columns,
    drawerOpen:
      typeof value.drawerOpen === 'boolean' ? value.drawerOpen : DEFAULT_SETTINGS.drawerOpen
  }
}
