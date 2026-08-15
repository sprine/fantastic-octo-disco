import { readdir, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { extname, join } from 'node:path'
import {
  MAX_IMPORT_BYTES,
  SUPPORTED_EXTENSIONS,
  WALK_MAX_DEPTH,
  WALK_MAX_FILES,
  type RejectReason
} from '../../shared/types.js'

/** `path` is where the guard tripped: a report that cannot say where is not actionable. */
export type GuardHit = { kind: 'depth' | 'count'; path: string }

export type Enumerated = {
  files: { path: string; bytes: number }[]
  rejected: { path: string; reason: RejectReason }[]
  /**
   * 'count': the walk stopped early, files went unseen. 'depth': branches were
   * pruned, the rest was scanned. Reported either way — a truncated import that
   * looks complete is data loss.
   */
  guardHit: GuardHit | null
  /** Directories the walk read, so standing 'folder-unreadable' complaints can be cleared. */
  scanned: string[]
}

export type WalkLimits = { maxDepth: number; maxFiles: number; maxBytes: number }

export const DEFAULT_LIMITS: WalkLimits = {
  maxDepth: WALK_MAX_DEPTH,
  maxFiles: WALK_MAX_FILES,
  maxBytes: MAX_IMPORT_BYTES
}

const supported = new Set<string>(SUPPORTED_EXTENSIONS)
const isSupported = (path: string) => supported.has(extname(path).toLowerCase())

/** Walks dropped/picked files and folders. Guards bound the blast radius of one wrong drop. */
export async function enumerateImages(
  inputs: string[],
  limits: WalkLimits = DEFAULT_LIMITS
): Promise<Enumerated> {
  const out: Enumerated = { files: [], rejected: [], guardHit: null, scanned: [] }

  /** 'count' outranks 'depth': it is the one that means files went unseen. */
  const note = (kind: 'depth' | 'count', path: string) => {
    if (out.guardHit === null || (kind === 'count' && out.guardHit.kind === 'depth')) {
      out.guardHit = { kind, path }
    }
  }

  const isDirectory = async (path: string): Promise<boolean> =>
    (await stat(path).catch(() => null))?.isDirectory() ?? false

  // Rejections count against the cap too: a drop entirely over the size cap
  // must not walk past the limit unbounded and report nothing.
  const seen = () => out.files.length + out.rejected.length
  const reject = (path: string, reason: RejectReason): void => {
    if (seen() >= limits.maxFiles) return note('count', path)
    out.rejected.push({ path, reason })
  }

  /** Takes stats when the caller already has them: nothing is stat'ed twice. */
  const accept = async (path: string, known?: Stats): Promise<void> => {
    if (!isSupported(path)) return // silent: not an image
    if (seen() >= limits.maxFiles) return note('count', path)

    const info = known ?? (await stat(path).catch(() => null))
    if (!info) return reject(path, 'unreadable')
    // A dirent reports the link, not its target, so a symlink named 2024.jpg
    // pointing at a directory reaches here looking like a small file.
    if (!info.isFile()) return
    if (info.size > limits.maxBytes) return reject(path, 'too-large')
    out.files.push({ path, bytes: info.size })
  }

  /**
   * Too deep prunes this branch only; the rest of the import still happens.
   * Symlinked directories inside the tree are reported, not followed — a real
   * tree cannot cycle, which is what lets this stay a plain recursion with no
   * visited set. A symlinked folder dropped directly still works: the
   * top-level stat below follows it.
   */
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth >= limits.maxDepth) return note('depth', dir)

    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return reject(dir, 'folder-unreadable')
    out.scanned.push(dir)
    for (const entry of entries) {
      if (out.guardHit?.kind === 'count') return
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path, depth + 1)
      else if (entry.isSymbolicLink() && (await isDirectory(path))) {
        reject(path, 'folder-skipped')
      } else await accept(path)
    }
  }

  for (const input of inputs) {
    if (out.guardHit?.kind === 'count') break
    const info = await stat(input).catch(() => null) // follows a top-level symlink
    if (!info) reject(input, 'unreadable')
    else if (info.isDirectory()) await walk(input, 0)
    // Silence about an unsupported file is right inside a walk and wrong for
    // one the user named: a HEIC dropped on the window must land somewhere.
    else if (!isSupported(input)) reject(input, 'unsupported')
    else if (!info.isFile()) reject(input, 'unreadable') // socket or fifo named .jpg
    else await accept(input, info)
  }
  return out
}
