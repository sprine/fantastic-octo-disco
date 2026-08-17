# CLAUDE.md

Electron + React + TypeScript image library. Indexes images **in place** (never copies
originals), derives WebP previews in worker threads, serves them to a sandboxed renderer
over a custom `img://` protocol backed by SQLite.

## Commands

```bash
npm run dev          # electron-vite dev with hot reload
npm run build        # tsc (node + web projects) + electron-vite build → out/
npm run test:unit    # fast: vitest, no Electron
npm run test:smoke   # builds, then boots the real app once and asserts the seams
npm test             # both
```

Node 22+. `node:sqlite` needs `NODE_OPTIONS=--experimental-sqlite` under plain node
(already set in the npm scripts); Electron's bundled Node has it available.

## Architecture in six lines

- **Renderer** is fully sandboxed (`contextIsolation`, `sandbox`, no Node). It reaches main
  only through `window.api` (preload) and names images by **id**, never by path.
- **`img://image/<id>/<variant>`** resolves id → derivative path via the database.
  Unknown id = 404: *the index is the allowlist*. Handler sits behind a memo cache.
- **`src/shared/ipc.ts`** is the contract both preload and main import — drift between the
  two sides is a compile error, not a runtime surprise.
- **Ingestion is durable**: `ingestion_log` is the work queue *and* failure history.
  Workers claim rows with a conditional UPDATE; a forced quit loses no bookkeeping.
- **Two worker threads** run sharp (the only native module). Decode memory scales with
  decoded pixels, so more threads buys thrash, not throughput.
- **One SQLite connection per thread** (main + each worker), WAL, busy_timeout 5s.
  All SQL text lives in `db/queries.ts`; schema in `db/migrations.ts`.

## Invariants — do not break these

1. **Protocol cache caches hits only and heals itself** (`protocol.ts`): a derivative
   path is a pure function of (id, variant), so a hit goes stale only when its file
   vanishes — and a failed serve evicts the entry and answers 404. No code anywhere
   calls invalidate; keep it that way. Never cache a miss: that would re-create the
   "every writer of `thumb_path`/`display_path` must invalidate or the image 404s
   forever" discipline, enforceable only by a hand-maintained writer list.
2. **Commit order**: derivative files land on disk (scratch name → `rename`) *before* the
   row flips to `ready` (`processJob.ts`). Never reverse it — a crash must never produce a
   ready row with no file behind it.
3. **Ownership**: `complete`/`fail` are guarded by `claimed_by`. A worker that lost its
   claim to the abandon sweep must not close out the job or condemn the image.
4. **Canonical paths**: every path entering `images` goes through `canonicalisePath()`.
   The UNIQUE index is the dedupe; do not add application-side existence checks.
5. **Migrations are append-only**: never edit a shipped entry in `MIGRATIONS`; push a new
   one. `PRAGMA user_version` = array index + 1.
6. **Failures are never silent**: anything that stops a file arriving (rejection, walk
   guard, decode error, exhausted retries) must end up in `ingestion_log` where the footer
   lists it. A truncated import that looks complete is data loss.
7. **Destructive confirmation lives in main** (`removeImage`), not on buttons. Renderer
   code must not add its own confirm dialogs.

## Gotchas

- Preload must be **CJS** (`index.cjs`): a sandboxed renderer cannot load an ESM preload.
  `electron.vite.config.ts` handles this; don't change the output format.
- `worker.ts` is a **second rollup entry** so `new Worker(new URL('./worker.js', ...))`
  resolves beside `index.js` in `out/main/`.
- `registerImgScheme()` must run **before** `app.whenReady()` — scheme privileges freeze.
- The `img` URL keeps the id in the **path**, not the host: Chromium canonicalises a
  numeric host into an IPv4 address.
- Sessions (`ingestion_log.session`) scope the progress strip to one import run. `done`
  rows are never pruned, so any unscoped count re-opens the "5000/5010" bug.
- `retried = 1` rows are exempt from cancel — see migration comment and `queue.test.ts`
  ("two clicks must not silently delete a file record").
- EXIF timestamps are wall clocks read as UTC everywhere (ordering consistency); the
  detail panel renders them back in UTC on purpose.
- Grid is deliberately **not virtualised** (measured: plain DOM holds 120Hz at 5000 tiles;
  page size caps at 500). Don't add a virtual scroller without new measurements.

## Testing philosophy

Units cover the three things most likely to rot: the queue state machine, canonical-path
rules, and the walk/EXIF edge rules. Renderer maths (zoom, layout snapping, menu
placement, panel building) is pulled into pure modules precisely so it tests without a
DOM. The smoke suite boots the real binary once and checks only wiring (bridge, schema,
protocol allowlist, one real worker decode) — keep interface behaviour out of it.

When you change `DERIVATIVE_SIZES.display`, the pin test in `derive.test.ts` will point
you at `DISPLAY_DERIVATIVE_PX`; change both.

## Style

Comments explain *why* the code is the way it is — constraints, failure modes, rejected
alternatives — never what the next line does. Keep them short. Match the existing
voice: declarative, one idea per comment, no changelog narration.
