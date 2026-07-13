# Phase 6: Version History — Implementation Plan v3

> **Status:** Planning (no code yet) — **refactored to make every slice "sờ được trên app"**
> **Effort estimate:** ~32h (up from 28h; +4h for per-slice UI demo harness + flow files)
> **Repo:** `/Users/trannhan/project/openwork`
> **WBS ref:** [WBS.md line 156-181](../../WBS.md)
> **Port guide ref:** [aionui-to-openwork-port-guide.md §6](../../aionui-to-openwork-port-guide.md) (lines 819-921)
> **AionUi ref (fetched):** `usePreviewHistory.ts`, `PreviewHistoryDropdown.tsx`, `preview.ts` types

---

## 0. Background & reality-check

### Building blocks already in OpenWork

| Building block | File | What it gives us |
|---|---|---|
| Revision tracking | `apps/server/src/file-sessions.ts` | `mtimeMs:size` revision + conflict detection (`ifMatchRevision` in write ops) — NOT a snapshot, just an ID |
| Audit trail | `apps/server/src/audit.ts` | Append-only JSONL per workspace (`~/.openwork/openwork-server/audit/<ws>.jsonl`) |
| DiffViewer | `apps/app/src/react-app/domains/session/artifacts/viewers/diff-viewer.tsx` | Side-by-side unified-diff renderer, parses `@@ -a,b +c,d @@` hunks |
| Files API | `apps/server/src/routes/files.ts` | `dir`, `stat`, `content` (read/write), `mkdir`, `delete`, `rename`, `batch`, `inbox`, `outbox` |
| DB infra | `apps/server/src/runtime-opencode-config-store.ts` etc. | Drizzle + `bun:sqlite` (or `node:sqlite` fallback) → `runtime.sqlite` at `~/.openwork/openwork-server/runtime.sqlite` |
| Eval flow harness | `evals/flows/*.flow.mjs` | E2E flow runner driving real app via `window.__openworkControl`; outputs screenshots. **The "sờ được" mechanism.** |

### What AionUi does (real source, fetched)

- `usePreviewHistory.ts` — React hook: `list`, `save`, `getContent` via `ipcBridge.previewHistory.*`
- `PreviewHistoryDropdown.tsx` — UI panel: list of snapshots, click to load content into editor
- **Trigger model:** AionUi snapshot is **manual** (button), debounced 1s (`SNAPSHOT_DEBOUNCE_TIME`)
- **Restore model:** AionUi "restore" = fetch snapshot content → push to client editor (no server-side restore)
- **Type:** `PreviewSnapshotInfo = { id, label, created_at, size, contentType, file_name?, file_path? }`

### 5 reviewer decisions (locked 2026-07-12)

| # | Decision |
|---|----------|
| 1 | Hardcode `SNAPSHOT_KEEP_LAST = 200` per file (no config v1) |
| 2 | Binary files: skip silently, no audit log |
| 3 | Manual snapshot button in **both** artifact-panel header + FileHistoryPanel header |
| 4 | Workspace "All changes" view: include v0 in slice 6.5b |
| 5 | e2e restore test: happy path only (no conflict/chain tests) |

---

## 1. The "sờ được" rule

> **Every slice must produce something visible/interactive in the running app, plus a flow file under `evals/flows/` that drives that UI and saves a screenshot.**

This means even "pure backend" slices ship a tiny UI surface for inspection:

- **Slice 6.1 (DB schema only):** ships a dev panel `/_dev/history?debug=1` with a Save form calling `SnapshotStore` directly. Flow clicks Save, asserts count goes 0→1, screenshots before/after.
- **Slice 6.2 (auto-middleware):** ships a status badge in `artifact-panel` header showing "auto-snapshot: on · last: 2s ago" + adds `/history/latest` endpoint. Flow opens file, edits, screenshots badge update.
- **Slice 6.3 (API routes):** dev panel upgraded to hit the 4 HTTP endpoints (Save/List/GetContent/Restore) instead of the direct bridge. Flow drives all 4 buttons, screenshots populated panel.
- **Slice 6.4 (UI dropdown):** the real `FileHistoryPanel` with manual button. Compare button stubbed. Flow clicks History, Save, Restore, screenshots each step.
- **Slice 6.5a (diff):** "Compare with current" button wires up + fills diff endpoint stub. Flow clicks Compare, screenshots DiffViewer rendering.
- **Slice 6.5b (All changes):** second tab. Flow clicks it, screenshots the list with multiple files.

**All flows land in `evals/flows/phase-6-history-*.flow.mjs`. All screenshots land in `evals/results/phase-6-history-*/`.** Reviewer runs `pnpm evals phase-6-history-*` to see each slice working.

---

## 2. Slice breakdown — 6 reviewable PRs, each "sờ được"

### Slice 6.1 — DB schema + SnapshotStore + dev panel (Backend + UI, ~3h)

**Backend deliverable:** `SnapshotStore` with Drizzle + `file_snapshots` table.

**UI deliverable:** dev panel `/_dev/history` (gated by `import.meta.env.DEV` + `?debug=1` query) with:
- Table: workspace | file path | snapshot count | last snapshot at
- Form: workspace + path + content textarea + "Save" button → calls `POST /api/.../history/snapshot` (server-side direct call, no HTTP — just store method)
- Form: snapshot ID + "Delete" button → calls `SnapshotStore.delete`

The "Save" button exists in slice 6.1 even though the HTTP route doesn't — it calls the **store** directly via a dev-only IPC bridge. This is the proof slice: store works, dev panel can drive it end-to-end, count goes from 0 → 1.

**Files:**
- `apps/server/src/file-snapshots.ts` (new) — store class
- `apps/server/src/file-snapshots.test.ts` (new) — 4 unit tests
- `apps/server/src/types.ts` (modify) — add `FileSnapshot` type
- `apps/app/src/dev/history-debug.tsx` (new) — dev panel with table + Save form + Delete button
- `apps/app/src/dev/history-debug.test.tsx` (new) — render tests
- `apps/app/src/dev/history-debug-bridge.ts` (new) — dev-only IPC bridge calling `SnapshotStore` directly (server-side handler in `apps/server/src/dev/history-debug-handler.ts`)
- `apps/server/src/dev/history-debug-handler.ts` (new) — server-side dev handler exposing `store.save`, `store.delete`, `store.list`, `store.countByWorkspace`
- `evals/flows/phase-6-history-1-schema.flow.mjs` (new) — drives panel, screenshots before/after Save

**UI demo path:**
1. Open app, navigate to `/_dev/history?debug=1`
2. See table (empty initially)
3. Fill in workspace + path + "hello world" content
4. Click "Save" → table updates, count=1
5. Click "Save" again with same content → count still 1 (hash dedup)
6. Screenshot `01a-dev-panel-empty.png` + `01b-dev-panel-after-save.png`

**Schema (with the dedup index from round-2 review):**
```sql
CREATE TABLE file_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  trigger TEXT NOT NULL,             -- 'auto' | 'manual'
  revision TEXT
);
CREATE INDEX idx_snapshots_workspace_file
  ON file_snapshots(workspace_id, file_path, created_at DESC);
CREATE UNIQUE INDEX idx_snapshots_dedup
  ON file_snapshots(workspace_id, file_path, content_hash);
```

> **Round-3 fix:** added `UNIQUE` index on `(workspace_id, file_path, content_hash)` so the dedup check (used in slice 6.2 middleware) becomes a single SQL statement instead of "SELECT latest then compare" — race-free and faster.

**API:**
```ts
class SnapshotStore {
  save(input): FileSnapshot        // throws on hash conflict (caught and converted to "no-op")
  list(workspaceId, filePath, opts?): FileSnapshot[]
  getById(workspaceId, snapshotId): FileSnapshot | null
  delete(workspaceId, snapshotId): boolean
  trim(workspaceId, filePath, keepLast = 200): number
  countByWorkspace(workspaceId, filePath?): number  // for debug panel
  findLatest(workspaceId, filePath): FileSnapshot | null  // for badge in slice 6.2
}
```

**Tests:** 5 unit tests (save/list roundtrip, dedup-on-hash throws, trim, getById-null, count, findLatest).

**Reviewable as:** Store works (unit), dev panel clickable end-to-end (flow), screenshot shows count go from 0 to 1.

---

### Slice 6.2 — Auto-snapshot middleware + status badge (Backend + UI, ~5h)

**Backend deliverable:** Auto-snapshot on write. **UI deliverable:** status badge in `artifact-panel` header showing "auto-snapshot: on · last: 2s ago".

**Files:**
- `apps/server/src/snapshot-middleware.ts` (new) — `maybeSnapshotBeforeWrite(workspaceId, filePath, opts)`
- `apps/server/src/snapshot-middleware.test.ts` (new) — 6 tests
- `apps/server/src/routes/files.ts` (modify) — call middleware in write paths
- `apps/app/src/react-app/domains/session/artifacts/history-status-badge.tsx` (new) — badge component
- `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` (modify) — mount badge
- `apps/app/src/react-app/domains/session/artifacts/history-status-badge.test.tsx` (new) — 2 tests
- `apps/server/src/routes/history.ts` (modify, in this slice) — add `GET /workspace/:id/files/:path/history/latest` → `{ snapshot: FileSnapshot | null }`. Reused by badge + future slices.
- `evals/flows/phase-6-history-2-auto-snapshot.flow.mjs` (new)

**UI demo path:**
1. Open a text file in artifact panel
2. Badge in header reads "auto-snapshot: on · last: never"
3. Edit the file via chat (or directly via dev panel from 6.1)
4. Badge updates to "last: just now"
5. Screenshot `02a-badge-before-edit.png` + `02b-badge-after-edit.png`

**Middleware behavior (with loop prevention from round-3 review):**
- Signature: `maybeSnapshotBeforeWrite({ workspaceId, filePath, content, trigger, skipAutoSnapshot?: boolean })`
- If `skipAutoSnapshot === true` (used by `POST /history/snapshot` and `POST /history/:id/restore` in later slices) → return without snapshotting
- Else: read current content (if exists) before mutation
- Skip if size >5MB or null byte in first 8KB
- Use UNIQUE index from 6.1 — `INSERT ... ON CONFLICT DO NOTHING` (race-free, no manual hash check)
- `void save().catch(log)` — async, don't block write
- Add audit entry only on success

**Latest endpoint (added in this slice, not 6.3):**
- `GET /workspace/:id/files/:path/history/latest` → `{ snapshot: FileSnapshot | null }`
- Powers the status badge polling
- Returns 200 always (null when no snapshots)
- 5 LOC + 1 test (covers null + present cases)

**Tests:** 6 unit tests (modify, dedup-via-conflict, oversize, binary, delete, failure path) + 1 endpoint test (latest).

**Reviewable as:** Backend works, badge visible in real app, loop prevented. Flow: 2 screenshots (before/after edit).

---

### Slice 6.3 — History API routes + dev panel clickable (Backend + UI, ~5h)

**Backend deliverable:** 4 REST endpoints (`/latest` already in 6.2). **UI deliverable:** dev panel upgraded with 4 working buttons hitting the HTTP routes (replaces the direct-bridge Save from 6.1).

**Files:**
- `apps/server/src/server/normalize-path.ts` (new) — **extract** `normalizeWorkspaceRelativePath` from `routes/files.ts`
- `apps/server/src/routes/files.ts` (modify) — import extracted helper
- `apps/server/src/routes/history.ts` (modify) — add 4 endpoints (diff returns 501 stub) — `/latest` already in 6.2
- `apps/server/src/routes/history.test.ts` (new) — 7 e2e tests
- `apps/server/src/routes/registry.ts` (modify) — register history routes (order: static before dynamic)
- `apps/server/src/server.ts` (modify) — wire `addHistoryRoutes`
- `apps/app/src/dev/history-debug.tsx` (modify) — replace direct-bridge Save with HTTP form; add List / GetContent / Restore buttons
- `evals/flows/phase-6-history-3-api-routes.flow.mjs` (new)

**Path encoding (round-3 fix):** OpenWork paths can contain `/` (e.g. `src/components/Button.tsx`). Two options:
- (a) **URL-encoded**: client must encode `/` → `%2F`, server decodes back
- (b) **Query param**: `/workspace/:id/history?path=...&action=...` — no encoding, path is a single query value

**Decision: option (b) for all history endpoints** — flatter URL space, no double-encoding bugs, easier to debug. The `routes/files.ts` existing routes use `:path` in the URL because Bun/Hono supports the wildcard; for history we'll be consistent with ourselves and use query param. This deviates from `routes/files.ts` but for good reason (history is a sub-resource of a file, not the file itself).

**Final endpoint shape (all use query param `?path=...`):**

| # | Method | Path | Body | Returns |
|---|---|---|---|---|
| 1 | `GET`  | `/workspace/:id/history/latest?path=` | — | `{ snapshot }` (from 6.2) |
| 2 | `POST` | `/workspace/:id/history/snapshot?path=` | `{ content, trigger? }` | `FileSnapshot` |
| 3 | `GET`  | `/workspace/:id/history?path=&limit=&before=` | — | `{ items }` |
| 4 | `GET`  | `/workspace/:id/history/diff?path=&from=&to=` | — | `501` (slice 6.5a fills) |
| 5 | `GET`  | `/workspace/:id/history/:snapshotId/content?path=` | — | `{ content, hash, ts }` |
| 6 | `POST` | `/workspace/:id/history/:snapshotId/restore?path=` | `{ revision? }` | `{ ok, newRevision }` |

> **Route ordering:** `#1-#4` have static tail (`/latest`, `/snapshot`, `/diff`, none) — must be registered before `#5-#6` (dynamic `:snapshotId`). Comment in `addHistoryRoutes` warns future devs.

**UI demo path:**
1. Open `/_dev/history?debug=1`
2. Pick a workspace + enter path `src/example.ts`
3. Click "Save" with content "v1" → row appears
4. Click "Save" with "v2" → 2nd row
5. Click "GetContent" on row 1 → textarea shows "v1"
6. Click "Restore" on row 1 → file on disk becomes "v1", new auto-snapshot row created (count=3)
7. Screenshot `03-dev-panel-after-restore.png`

**Tests:** 7 e2e tests (list, limit, save, getContent, restore, 404, 403). Path with `/` in it covered. Diff endpoint skipped (returns 501).

**Reviewable as:** All 4 functional endpoints clickable in dev panel via real HTTP. Restore actually overwrites a real file. Flow: 1 screenshot showing populated panel after sequence.

---

### Slice 6.4 — FileHistoryPanel + manual button + History tab (Frontend, ~9h)

**UI deliverable:** The real `FileHistoryPanel` Popover with list, "Restore" + "Save snapshot" buttons (in panel header). Also the primary "History" + "Save snapshot" buttons in `artifact-panel` header. The "Compare with current" button is **stubbed** in this slice (renders "Coming in 6.5a" tooltip) — 6.5a wires it up.

**Files:**
- `apps/app/src/react-app/domains/session/artifacts/file-history-panel.tsx` (new) — main UI
- `apps/app/src/react-app/domains/session/artifacts/file-history-panel.test.tsx` (new) — 5 tests
- `apps/app/src/react-app/domains/session/artifacts/hooks/use-file-history.ts` (new) — TanStack Query hooks
- `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` (modify) — add 2 buttons in header
- `apps/app/src/lib/api/files.ts` (modify) — 4 client functions: `listHistory`, `saveSnapshot`, `getSnapshotContent`, `restoreSnapshot`
- `evals/flows/phase-6-history-4-panel.flow.mjs` (new)

**UI demo path:**
1. Open any text file in artifact panel
2. Header now has 2 buttons: `[History]` `[Save snapshot]`
3. Click "History" → Popover opens with snapshot list
4. Click "Save snapshot" first → list grows by 1
5. Edit file → wait 1s → click History again → another auto-snapshot appears
6. Click "Restore" on old snapshot → file content reverts, new auto-snapshot of pre-restore state
7. Click "Compare" on a row → tooltip "Coming in 6.5a" (button is real, just no-op)
8. Screenshot `04-popover-with-history.png`

**Null-safety contract (from AionUi line 145):**
- `useFileHistory({ workspaceId, filePath })` returns early if either is undefined
- No API call, no loading flash
- Component renders nothing

**Cross-slice contract for `currentContent` (round-3 fix):**
- `useFileHistory` does **not** read current file content — that's a separate query owned by `artifact-panel.tsx`
- The panel receives `currentContent?: string` as a prop (already loaded by parent for editing)
- In slice 6.4, `currentContent` is passed but unused (only used by 6.5a's Compare button)
- 6.5a's diff endpoint accepts `?from=snapId&to=current` — UI fetches diff on demand

**Popover vs Sheet vs inline:** will read `right-panel.tsx` during prep and follow whatever pattern Phase 12 established. Fallback: shadcn `Popover` with `Portal`.

**Tests:** 5 component tests (null-guard, empty state, render N items, restore mutation, manual save, Compare button shows tooltip).

**Reviewable as:** This is the main user-facing feature. Flow: 3 screenshots (empty, after save, after restore).

---

### Slice 6.5a — Diff generator + "Compare with current" (Backend + UI, ~5h)

**Backend deliverable:** `unifiedDiff()` + fill the diff endpoint stub. **UI deliverable:** "Compare with current" button in each history row, renders `DiffViewer` inline.

**Files:**
- `apps/server/src/diff.ts` (new) — `unifiedDiff(oldText, newText, opts)`
- `apps/server/src/diff.test.ts` (new)
- `apps/server/src/routes/history.ts` (modify) — fill diff endpoint stub
- `apps/server/src/routes/history.test.ts` (modify) — diff endpoint tests
- `apps/app/src/react-app/domains/session/artifacts/file-history-panel.tsx` (modify) — add Compare mode (select a snapshot → show DiffViewer vs current)
- `apps/app/src/lib/api/files.ts` (modify) — add `getHistoryDiff(from, to)` (5th client fn)
- `apps/app/package.json` (modify) — add `diff` + `@types/diff` if missing
- `evals/flows/phase-6-history-5a-diff.flow.mjs` (new)

**UI demo path:**
1. Open file with 3+ snapshots
2. Click History → click "Compare" on snapshot 2
3. Panel switches to DiffViewer view: snapshot 2 (left) vs current file (right)
4. Edit file → click "Refresh diff" → DiffViewer updates
5. Screenshot `05a-diff-viewer.png`

**Diff generator:**
- `diff.createPatch(fileName, oldStr, newStr, oldHeader, newHeader, { context: 3 })`
- Identical inputs → `""`
- 1MB cap each side → `PayloadTooLargeError` → 413

**Tests:** 5 unit tests (added, removed, multi-hunk, identical→empty, oversize→throw).

**Reviewable as:** Click Compare, see actual diff rendered. Flow: 1 screenshot of DiffViewer in panel.

---

### Slice 6.5b — "All changes" tab (Backend + UI, ~4h)

**Backend deliverable:** `GET /workspace/:id/changes` endpoint. **UI deliverable:** second tab in `FileHistoryPanel` listing all files in workspace with snapshots.

**Files:**
- `apps/server/src/routes/history.ts` (modify) — add changes endpoint
- `apps/server/src/routes/history.test.ts` (modify) — add 4 tests
- `apps/app/src/react-app/domains/session/artifacts/file-history-panel.tsx` (modify) — add Tabs (History / All changes)
- `apps/app/src/react-app/domains/session/artifacts/hooks/use-file-history.ts` (modify) — add `useWorkspaceChanges`
- `apps/app/src/lib/api/files.ts` (modify) — add `listWorkspaceChanges` (6th client fn)
- `evals/flows/phase-6-history-5b-all-changes.flow.mjs` (new)

**UI demo path:**
1. Edit 3 different files in workspace
2. Click History on file 1
3. Switch to "All changes" tab → see 3 files, sorted by latest edit
4. Click a row → switches back to History tab with that file active
5. Screenshot `05b-all-changes-tab.png`

**Endpoint with cursor pagination (round-3 fix):**
```
GET /workspace/:id/changes?limit=100&before=<ts>
→ {
    items: [{ filePath, latestSnapshotAt, snapshotCount, latestTrigger }],
    nextCursor: <ts> | null
  }
```

SQL (with cursor pushed to HAVING):
```sql
SELECT file_path,
       MAX(created_at) AS latest,
       COUNT(*) AS count,
       (SELECT trigger FROM file_snapshots s2
        WHERE s2.workspace_id = ? AND s2.file_path = file_snapshots.file_path
        ORDER BY s2.created_at DESC LIMIT 1) AS trigger
FROM file_snapshots
WHERE workspace_id = ?
GROUP BY file_path
HAVING MAX(created_at) < ?
ORDER BY MAX(created_at) DESC
LIMIT ?
```

> **Round-3 fix:** `HAVING MAX(created_at) < ?` pushes the cursor into the GROUP BY so we don't scan all snapshots just to throw away groups. Still O(n) in workspace size but n = # of distinct file_paths, not total snapshots.

**Cap:** `limit` 1-500, default 100. Return `nextCursor` when more groups exist.

**Tests:** 4 (empty workspace, single file, multi-file sort, cross-workspace isolation, cursor pagination).

**Reviewable as:** Tab toggle shows workspace-wide snapshot summary. Flow: 2 screenshots (History tab, All changes tab).

---

## 3. Rollout plan

```
PR #1 (6.1):  Schema + dev panel          ~3h     sờ được: dev panel Save → count
PR #2 (6.2):  Auto-snapshot + badge       ~5h     sờ được: badge updates + /latest endpoint
PR #3 (6.3):  API routes + dev buttons    ~5h     sờ được: HTTP form drives Restore
PR #4 (6.4):  FileHistoryPanel + buttons  ~9h     sờ được: full popover (Compare stubbed)
PR #5 (6.5a): Diff generator + Compare    ~5h     sờ được: DiffViewer renders
PR #6 (6.5b): All changes tab             ~4h     sờ được: tab toggle
                                                       ──────────────
Subtotal code:                                            ~31h
Buffer (cross-slice, reviews):                            +1h
                                                       ──────────────
Total:                                                    ~32h
```

> **Vs WBS:** original 26h. +6h for: per-slice UI demo harness (debug panel, badge, dev buttons) + 6 flow files + 1 dev-bridge handler. The user explicitly asked for "sờ được trên app" so this is intentional.

**Buffer allocation:**
- Slice 6.1: +0.5h (UNIQUE index migration + dev bridge handler)
- Slice 6.4: +1h (UI always expands; Popover choice, manual button position)
- Slice 6.5a: +0.5h (DiffViewer integration quirks; filling diff endpoint stub)
- Slice 6.5b: +0.5h (HAVING cursor SQL tuning)
- Cross-slice: -1.5h (some items absorbed into slice effort above)

**Merge order:** strictly 6.1 → 6.2 → 6.3 → 6.4 → 6.5a → 6.5b. Each builds on the previous. 6.5a fills diff stub from 6.3.

**Reviewer run sequence** after each PR:
```bash
pnpm evals phase-6-history-1-schema       # or 2, 3, 4, 5a, 5b
ls evals/results/phase-6-history-*/       # inspect screenshots
```

---

## 4. Cross-cutting concerns

### Testing strategy (no fraimz, per user)

- Backend: `bun:test` (see `file-sessions.test.ts`) + `runtime.sqlite` in tmp dir
- Frontend: `bun:test` + `renderToStaticMarkup` (see `question-modal.test.tsx`)
- E2E "sờ được": `evals/flows/*.flow.mjs` driving real Electron app
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck` per package

### Test command matrix

| Slice | Commands |
|---|---|
| 6.1 | `pnpm --filter @openwork/server test file-snapshots` + `pnpm evals phase-6-history-1-schema` |
| 6.2 | `pnpm --filter @openwork/server test snapshot-middleware files` + `pnpm evals phase-6-history-2-auto-snapshot` |
| 6.3 | `pnpm --filter @openwork/server test routes/history` + `pnpm --filter @openwork/server typecheck` + `pnpm evals phase-6-history-3-api-routes` |
| 6.4 | `pnpm --filter @openwork/app test file-history-panel history-status-badge` + `pnpm evals phase-6-history-4-panel` |
| 6.5a | `pnpm --filter @openwork/server test diff` + `pnpm --filter @openwork/app test file-history-panel` + `pnpm evals phase-6-history-5a-diff` |
| 6.5b | `pnpm --filter @openwork/server test routes/history` + `pnpm evals phase-6-history-5b-all-changes` |

### Dependencies to add

- `apps/server`: none (uses existing `bun:sqlite` / `node:sqlite` + Drizzle)
- `apps/app`: `diff@^5.2.0` + `@types/diff@^5.2.0` (if not present — check first)

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| SQLite row size bloat from inline content | Cap at 5MB; LRU trim 200/file |
| Race in auto-snapshot | Async fire-and-forget + hash dedup |
| Restore corrupts file | `ifMatchRevision` from `file-sessions.ts` |
| Binary file crashes | Null-byte sniff; skip silently (decision #2) |
| Popover UI blocks clicks | shadcn Popover with Portal; follow Phase 12 pattern |
| Diff perf on large files | 1MB cap each side; 413 error |
| Dev panel leaks to prod | Gate by `import.meta.env.DEV` AND `?debug=1` query |

---

## 5. What this plan is NOT doing

- ❌ No `fraimz` validation (per user request; using `evals/flows` instead)
- ❌ No Git integration
- ❌ No cross-workspace snapshot search
- ❌ No per-user attribution beyond `actorTokenHash` from session
- ❌ No real-time snapshot streaming (TanStack Query polling)
- ❌ No "All changes" filtering/multi-select/bulk restore (v0 read-only)
- ❌ No "All changes" in dedicated route — it's a tab inside the History panel, not a separate page

---

## 6. File summary (new + modified)

**New files (16):**
- `apps/server/src/file-snapshots.ts`
- `apps/server/src/file-snapshots.test.ts`
- `apps/server/src/snapshot-middleware.ts`
- `apps/server/src/snapshot-middleware.test.ts`
- `apps/server/src/routes/history.ts` (built incrementally: 6.2 adds /latest, 6.3 adds 4 more, 6.5a fills diff, 6.5b adds /changes)
- `apps/server/src/routes/history.test.ts`
- `apps/server/src/diff.ts`
- `apps/server/src/diff.test.ts`
- `apps/server/src/server/normalize-path.ts`
- `apps/server/src/dev/history-debug-handler.ts` (slice 6.1 dev bridge)
- `apps/app/src/dev/history-debug-bridge.ts` (slice 6.1 client bridge)
- `apps/app/src/dev/history-debug.tsx`
- `apps/app/src/dev/history-debug.test.tsx`
- `apps/app/src/react-app/domains/session/artifacts/history-status-badge.tsx`
- `apps/app/src/react-app/domains/session/artifacts/history-status-badge.test.tsx`
- `apps/app/src/react-app/domains/session/artifacts/file-history-panel.tsx`
- `apps/app/src/react-app/domains/session/artifacts/file-history-panel.test.tsx`
- `apps/app/src/react-app/domains/session/artifacts/hooks/use-file-history.ts`
- `evals/flows/phase-6-history-1-schema.flow.mjs`
- `evals/flows/phase-6-history-2-auto-snapshot.flow.mjs`
- `evals/flows/phase-6-history-3-api-routes.flow.mjs`
- `evals/flows/phase-6-history-4-panel.flow.mjs`
- `evals/flows/phase-6-history-5a-diff.flow.mjs`
- `evals/flows/phase-6-history-5b-all-changes.flow.mjs`

**Modified files (8):**
- `apps/server/src/types.ts` (add `FileSnapshot`; potentially add `kind` to `AuditEntry`)
- `apps/server/src/routes/files.ts` (call auto-snapshot middleware; import extracted `normalizeWorkspaceRelativePath`)
- `apps/server/src/routes/registry.ts` (register history routes with order comment)
- `apps/server/src/server.ts` (wire `addHistoryRoutes` + dev bridge)
- `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` (mount badge, History button, Save button; pass `currentContent` to FileHistoryPanel in 6.5a)
- `apps/app/src/lib/api/files.ts` (6 client functions across slices 6.3, 6.4, 6.5a, 6.5b)
- `apps/app/package.json` (add `diff` + `@types/diff` if missing)
- `evals/results/` (gitkeep dir, populated by flows)

**LoC budget:** ~1,900 LOC (incl. tests + 6 flow files + dev bridge).

---

## 7. Self-review log (issues caught & fixed)

| Round | # | Severity | Issue | Fix |
|---|---|---|---|---|
| 1 | 1 | 🔴 | Route order collision (snapshot vs :snapshotId) | §2.3 — explicit registration order + comment |
| 1 | 2 | 🔴 | Diff endpoint ownership unclear | §2.3 stubs 501, §2.5a fills body |
| 1 | 3 | 🔴 | `useFileHistory` missing null-guard | §2.4 — null-safety contract |
| 1 | 4 | 🟡 | Client fn count mismatch (4 vs 5) | §2.4 split into 4+1, updated as 6 total across 6.4/6.5a/6.5b |
| 1 | 5 | 🟡 | `normalizeWorkspaceRelativePath` duplicate | §2.3 — extract to `server/normalize-path.ts` |
| 1 | 6 | 🟡 | `AuditEntry.kind` may not exist | §2.2 — flagged as prep task |
| 1 | 7 | 🟢 | Vague 4h buffer | §3 — explicit per-slice allocation |
| 2 | 8 | 🔴 | **Backend slices have no UI** → can't "sờ" between PRs | **§1 + §2** — every slice ships a UI surface (debug panel, badge, dev buttons) + flow file |
| 2 | 9 | 🟡 | "All changes" v0 too coarse (was 7h slice) | Split into 6.5a (diff, 5h) + 6.5b (All changes tab, 4h) → 2 smaller PRs |
| 2 | 10 | 🟡 | No concrete "what to click" in slices | Each slice now has "UI demo path" with click sequence + screenshot filename |
| 2 | 11 | 🟢 | Effort 26h→28h not explained | §3 — explicit "vs WBS +6h for UI demo harness" |
| 3 | 12 | 🔴 | Slice 6.1 dev panel has no way to create a snapshot → flow just shows empty table | §2.1 — add Save form calling `SnapshotStore` directly via dev bridge |
| 3 | 13 | 🔴 | **Auto-snapshot loop**: slice 6.2 middleware triggers on slice 6.3/6.4 manual writes → infinite auto-snapshots | §2.2 — `skipAutoSnapshot` flag on write path; manual snapshot calls pass `true` |
| 3 | 14 | 🔴 | URL-encoded `/` in `:path` is fragile (subdir files like `src/Button.tsx`) | §2.3 — switch all history endpoints to `?path=` query param; flatter URL space |
| 3 | 15 | 🟡 | Dedup race: "SELECT latest then compare" is racy under concurrent writes | §2.1 — add `UNIQUE INDEX (workspace_id, file_path, content_hash)` + use `ON CONFLICT DO NOTHING` |
| 3 | 16 | 🟡 | `useFileHistory` should NOT own `currentContent` (cross-slice contract unclear) | §2.4 — `currentContent` is a prop passed from `artifact-panel`; hook stays focused on snapshots |
| 3 | 17 | 🟡 | Badge needs `/history/latest` endpoint — wasn't in any slice's spec | §2.2 — endpoint lives in 6.2 (powers badge) |
| 3 | 18 | 🟡 | 6.5b "All changes" GROUP BY scans all snapshots; `before` only filters after group | §2.5b — push cursor to `HAVING MAX(created_at) < ?` |
| 3 | 19 | 🟡 | Slice 6.4 Compare button has no diff endpoint yet (6.5a not merged) | §2.4 — Compare button stubbed with "Coming in 6.5a" tooltip; real wiring in 6.5a |

---

## 8. Ready check

- [x] Reviewed existing building blocks + eval flow harness
- [x] Fetched real AionUi source (3 files)
- [x] Cross-referenced WBS + port guide
- [x] Defined 6 reviewable slices, every one "sờ được trên app"
- [x] Each slice has explicit "UI demo path" (click sequence + screenshot name)
- [x] 6 flow files specified (one per slice)
- [x] Listed all 16 new + 8 modified files
- [x] Test command matrix per slice
- [x] Documented risks + mitigations
- [x] Self-reviewed for 19 issues across 3 rounds
- [x] 5 reviewer decisions captured
- [x] "All changes" v0 split into 6.5b
- [x] Route ordering trap documented
- [x] Auto-snapshot loop prevented (skipAutoSnapshot flag)
- [x] Path encoding switched to query param
- [x] Dedup race fixed with UNIQUE index
- [x] "All changes" pagination pushed to HAVING clause
- [x] /latest endpoint placed in 6.2 (where badge needs it)
- [x] Compare button stubbed in 6.4, wired in 6.5a

**Awaiting:** reviewer go-ahead, or auto-proceed if no objection in next reply.

---

## 9. Quick reviewer checklist (per PR)

After each PR is merged, reviewer should be able to do this in ≤5 min:

```bash
cd /Users/trannhan/project/openwork
pnpm install
pnpm evals phase-6-history-N-<slice>
open evals/results/phase-6-history-N-*/screenshot.png
```

That's it. If the screenshot looks right and the unit tests pass, PR is good. No need to read the code in depth on first pass — the screenshot IS the proof.
