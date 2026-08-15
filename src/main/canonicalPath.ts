import { realpathSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export type CanonOptions = {
  platform?: NodeJS.Platform
  /** Off for pure tests and for paths that may not exist yet. */
  resolveSymlinks?: boolean
  cwd?: string
}

/**
 * Case sensitivity is a per-volume property, not a per-platform one, so folding
 * by platform is a deliberate approximation: the schema tolerates an occasional
 * near-duplicate rather than assuming the guarantee is airtight.
 */
const CASE_INSENSITIVE: ReadonlySet<NodeJS.Platform> = new Set(['darwin', 'win32'])

/** The single function the duplicate-import guarantee rests on. Keep it lean. */
export function canonicalisePath(input: string, opts: CanonOptions = {}): string {
  const platform = opts.platform ?? process.platform
  const path = platform === 'win32' ? win32 : posix

  // resolve() reads the cwd only when it needs one; passing it eagerly would
  // cost a syscall per file, and an import hands this thousands in a row.
  let p = path.isAbsolute(input) ? path.resolve(input) : path.resolve(opts.cwd ?? process.cwd(), input)
  if (opts.resolveSymlinks ?? true) p = realpathOrSelf(p)

  // APFS and HFS+ return NFD; user input and Windows return NFC.
  p = p.normalize('NFC')
  if (platform === 'win32') p = p.replace(/\\/g, '/')
  p = stripTrailingSeparator(p)

  return CASE_INSENSITIVE.has(platform) ? p.toLowerCase() : p
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return p // not yet on disk, or unreadable: resolve() is the best we have
  }
}

function stripTrailingSeparator(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}
