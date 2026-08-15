/** Shared so the audit tables cannot record the same failure in two formats. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
