import type { ImageRow } from '../../src/shared/types.js'

/**
 * A complete ImageRow with plausible defaults, so a new required column is one
 * edit here rather than a hand-written literal (or unsound cast) per test file.
 * Lives beside the renderer tests: tests/helpers.ts is node-typed, and the
 * renderer test project deliberately has no node types.
 */
export function imageRow(partial: Partial<ImageRow> = {}): ImageRow {
  return {
    id: 1,
    canonical_path: '/photos/dive.jpg',
    source_path: '/photos/dive.jpg',
    status: 'ready',
    drift: 'fresh',
    bytes: 2 * 1024 * 1024,
    width: 4000,
    height: 3000,
    format: 'jpeg',
    captured_at: Date.UTC(2024, 4, 1, 10, 30),
    imported_at: Date.UTC(2024, 5, 1),
    checked_at: null,
    mtime_ms: null,
    thumb_path: null,
    display_path: null,
    metadata_json: null,
    ...partial
  }
}
