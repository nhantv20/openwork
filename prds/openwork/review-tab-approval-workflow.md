# Plan: Review Tab — Approval Workflow cho AI Edits

> **Cập nhật:** 2026-07-12 (rev 2 — fix theo review của Mavis)
> **Mục tiêu:** Thêm tab **Review** vào right panel (thay vị trí Browser cũ) để user approve/reject AI edits trước khi chúng vào git. Browser chuyển ra sidebar rail.
> **Owner:** Nhân
> **Trạng thái:** 📌 Planning (rev 2)
>
> **Thay đổi rev 2:**
> - M1: thêm migration plan + verify `diffFileSnapshots` endpoint support `"current"`
> - M2: fix `useFileDiff` — diff từ `parentSnapshotId` → `current` (KHÔNG phải `snapshotId` → `current`)
> - M4: per-file loading state (`pendingMutationIds: Set<string>`)
> - M5: bulk transaction = best-effort, document rõ + client optimistic + rollback
> - M6: History pagination = "Load more" button + `nextCursor`
> - M7: lazy diff content, file size warning > 1MB / > 5000 dòng
> - M8: specify pulse animation (CSS class, trigger = `!seen && count > 0`, stop khi mở tab)
> - M9: grep `useAgentSnapshot` + `AgentReviewBanner` trước khi xóa
> - M10: thêm unit + integration tests, ErrorBoundary, i18n audit, A11y audit, polling pause khi tab hidden
> - Thêm `parentSnapshotId` nullable handling trong data model

---

## Concept cốt lõi

**State machine rõ ràng** cho mỗi file:

```
┌─────────────────┐         ┌──────────────────┐
│ PENDING APPROVAL│ ──────► │ APPROVED         │ → file vào git working tree
│ (AI vừa sửa)    │   ✓     │ (user đã duyệt)  │   user quản lý bình thường
└─────────────────┘         └──────────────────┘
        │
        │ ✗
        ▼
┌─────────────────┐
│ REJECTED        │ → restore snapshot, file về pre-AI state
│ (user từ chối)  │
└─────────────────┘
```

**Quy tắc:**
- **AI sửa file** → snapshot `agent` trigger + status = `pending` → hiện trong Review tab
- **Approve** → snapshot đánh dấu `approved`, file ở lại working tree (git quản lý từ đây)
- **Reject** → restore snapshot, file về trạng thái trước khi AI sửa
- **Manual edit** (user tự sửa) → KHÔNG vào Review, đi thẳng vào git (không cần approve)

→ **Review tab = hàng chờ duyệt AI edits**, không phải generic diff viewer.

---

## Layout tổng thể

### Sidebar rail (sau khi update)
```
┌──┐
│📋│  ← PanelRight (toggle Files/Preview/Review)
│🌐│  ← Browser (NEW - move từ right panel header ra đây)
│⚙️│  ← Settings
└──┘
```

### Right panel header (sau khi update)
**Trước:** `Files` · `Preview` · `Browser`
**Sau:** `Files` · `Preview` · `Review` (icon `GitCompare`, shortcut `⌘⌥3`)

### ReviewPanel — 3 inner tabs
**Changes** (default) · **History** · **Diff`

#### Changes tab
```
┌──────────────────────────────────────────────────────────────┐
│ 7 pending  +89 -12         [Approve all] [Reject all]  ⟳  │
├──────────────────────────────────────────────────────────────┤
│ ⌄ /Users/.../openwork-server.ts              +9 -2       │
│   AI edit · 2 min ago · 1938-1947 lines                       │
│   [View diff]  [Approve ✓]  [Reject ✗]                       │
│   ┌─ inline diff ──────────────────────────────────────┐    │
│   │ 1938  // Phase 6.8: latest agent-triggered... │ +green│   │
│   │ 1943    `/workspace/${encodeURIComponent...  │ -red  │   │
│   └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

#### History tab
Timeline agent snapshots với status filter (Pending/Approved/Rejected)

#### Diff tab
File picker + ref selector (Pre-AI snapshot → Current) + full DiffViewer

---

## Milestone Plan (10 milestones, mỗi cái testable trên app)

Mỗi milestone = 1 PR có thể merge + test độc lập trên app.

### M1: Backend foundation
**Scope:** Server endpoints + Client API types
**Files:**
- `apps/server/src/server/...` (snapshot store + router): thêm `status` field + 5 endpoints
- `apps/app/src/app/lib/openwork-server.ts`: thêm types + 5 methods

**Existing infra tận dụng được (verify từ codebase rev 2):**
- `OpenworkFileSnapshot` type đã ở `apps/app/src/app/lib/openwork-server.ts:449` — cần thêm `status?` + `parentSnapshotId?`
- `diffFileSnapshots` đã có ở `openwork-server.ts:1965`, signature: `(workspaceId, path, from, to) => { diff: string, fromMeta, toMeta }` — cần verify `to = "current"` work
- `getLatestAgentSnapshot` đã có ở `openwork-server.ts:1941` (Phase 6.8) — reuse cho badge
- `listWorkspaceChanges` đã có cursor pagination (`nextCursor: number | null`) — pattern reuse cho `listAgentSnapshots`
- DB schema ở `apps/server/src/server/...` (cần locate `FileSnapshot` table)

**Migration (quan trọng):**
- Existing snapshots trong DB: `status = undefined`, `parentSnapshotId = undefined` (no default backfill)
- Chỉ snapshots mới với `trigger = "agent"` mới có `status = "pending"` + `parentSnapshotId = <pre-AI snapshot>`
- Migration script: idempotent, không touch data cũ, chỉ thêm columns nullable
- Verify `diffFileSnapshots` endpoint support `to = "current"` — nếu chưa có, thêm vào scope M1 (HIGH PRIORITY)
- Nếu `diffFileSnapshots` chỉ accept snapshot IDs (không support `"current"`) → thêm route mới `/workspace/:id/diff-current?path=&from=<id>` riêng

**Data model fixes (rev 2):**
- `parentSnapshotId` phải nullable: `string | null` (snapshot đầu tiên trong file → không có pre-AI snapshot)
- `rejectSnapshot` server logic: nếu `parentSnapshotId === null` → return error `{ ok: false, code: "NO_PARENT_SNAPSHOT", message: "Cannot reject: no pre-AI snapshot available" }`

**New endpoints (server):**
- `GET /workspace/:id/pending-approvals` → `WorkspacePendingApproval[]`
- `POST /workspace/:id/approvals/:snapshotId/approve` → `{ ok: true }`
- `POST /workspace/:id/approvals/:snapshotId/reject` → `{ ok: true } | { ok: false, code: "NO_PARENT_SNAPSHOT" }`
- `POST /workspace/:id/approvals/approve-all` body `{ snapshotIds: string[] }` → `{ approvedCount, failed: [{snapshotId, reason}] }`
- `POST /workspace/:id/approvals/reject-all` body `{ snapshotIds: string[] }` → same shape
- `GET /workspace/:id/agent-snapshots?cursor=&limit=&status=` → `{ items: OpenworkFileSnapshot[], nextCursor: number | null }`

**Client API methods (5 new):**
- `listPendingApprovals(workspaceId)` → `WorkspacePendingApproval[]`
- `approveSnapshot(workspaceId, snapshotId)` → `void`
- `rejectSnapshot(workspaceId, snapshotId)` → `void` (throw on `NO_PARENT_SNAPSHOT`)
- `approveAllSnapshots(workspaceId, snapshotIds)` → `BulkApprovalResult`
- `rejectAllSnapshots(workspaceId, snapshotIds)` → `BulkApprovalResult`
- `listAgentSnapshots(workspaceId, opts)` → `{ items, nextCursor }`

**Test trên app:**
1. Start app, mở DevTools Network
2. Trigger AI edit 1 file (dùng existing flow)
3. Verify `GET /workspace/:id/pending-approvals` → trả về 1 item
4. Verify `POST /workspace/:id/approvals/:id/approve` → file status = approved
5. Verify `POST /workspace/:id/approvals/:id/reject` → file content restored
6. Test bulk endpoints với curl/Postman
7. Test edge case: reject snapshot có `parentSnapshotId = null` → trả error rõ ràng
8. Test migration: existing snapshot trong DB KHÔNG có `status` field → endpoint `GET agent-snapshots` filter vẫn chạy (return empty cho `status = pending`)
9. Verify `diffFileSnapshots` với `to = "current"` return diff đúng

**Pass:** API đúng contract, không regression, migration không corrupt data cũ, diff endpoint support "current"

---

### M2: State + Hooks layer
**Scope:** Zustand store + TanStack Query hooks (chưa wire UI)
**Files:**
- `apps/app/src/react-app/domains/session/panel/review-store.ts` (new)
- `apps/app/src/react-app/domains/session/artifacts/hooks/use-pending-approvals.ts` (new)
- `apps/app/src/react-app/domains/session/artifacts/hooks/use-agent-snapshots.ts` (new)
- `apps/app/src/react-app/domains/session/artifacts/hooks/use-file-diff.ts` (new)

**Critical fix (rev 2) — `useFileDiff` logic:**
```ts
// ❌ SAI (plan cũ)
queryFn: async () => {
  const result = await client.diffFileSnapshots(workspaceId, filePath, snapshotId, "current");
  return result.diff;
}

// ✅ ĐÚNG (plan mới)
queryFn: async () => {
  // Diff pre-AI → current (file sau khi AI sửa)
  if (!parentSnapshotId) throw new Error("No parent snapshot to diff against");
  const result = await client.diffFileSnapshots(workspaceId, filePath, parentSnapshotId, "current");
  return result.diff;
}
```

**Polling behavior (rev 2):**
- `usePendingApprovals` polling 10s
- **Pause khi `document.hidden === true`** (tab không visible) — tiết kiệm bandwidth
- Resume khi visibility change event fire
- `useEffect` cleanup đúng cách để tránh leak khi component unmount

**Test trên app:**
1. Mở app, trigger AI edit
2. React DevTools → tìm `useReviewStore` → verify `pendingBySession` update
3. Console log store state → verify `activeInnerTabBySession` default = "changes"
4. Verify polling 10s hoạt động (đợi AI edit mới → tự fetch)
5. Switch sang tab khác → polling pause (verify Network tab không có request mới)
6. Switch về tab OpenWork → polling resume
7. Verify `useFileDiff` render đúng diff pre-AI → current (KHÔNG phải snapshot → current)

**Pass:** Store + hooks hoạt động đúng, polling OK + pause on hidden, diff logic correct

---

### M3: UI shell — tabs + rail
**Scope:** Tab strip + sidebar rail (chỉ stub ReviewPanel body)
**Files:**
- `apps/app/src/react-app/shell/ui-state-store.ts`: thêm "review" vào type
- `apps/app/src/react-app/domains/session/panel/right-panel.tsx`: thay browser→review
- `apps/app/src/react-app/domains/session/panel/review-panel.tsx` (new — stub)
- `apps/app/src/react-app/domains/session/chat/session-page.tsx`: thêm Browser rail button

**Conflict resolution (rev 2):**
- `SidePanelItem` type = `"files" | "preview" | "review" | "browser"`
  - `"review"` = tab mới trong right panel header
  - `"browser"` = mode legacy, vẫn supported cho rail button (open right panel ở mode browser)
- Tab strip CHỈ render: `Files | Preview | Review`
- Browser chỉ accessible qua sidebar rail button → click → set `activePanelItem = "browser"` → render BrowserPanel component (cũ)
- KHÔNG conflict: 2 entry riêng biệt, cùng render trong cùng panel container

**ErrorBoundary (rev 2):**
- Wrap `<ReviewPanel />` trong `<ErrorBoundary>` với fallback UI: "Review panel failed to load. [Reload]"
- Đặt ErrorBoundary ở `right-panel.tsx` (boundary level panel, không phải app-wide)

**Test trên app:**
1. Right panel header giờ có `Files | Preview | Review` (không còn Browser)
2. Click Review tab → right panel mở + hiện "Review panel" placeholder
3. Sidebar rail có 3 buttons: PanelRight | Browser (Globe) | Settings
4. Click Browser rail button → mở right panel ở browser mode (giống cũ)
5. Verify `activePanelItem === "review"` và `=== "browser"` đều work độc lập
6. Force throw error trong ReviewPanel → ErrorBoundary fallback render đúng, không crash app

**Pass:** Tab + rail hoạt động, không regress browser flow, ErrorBoundary OK

---

### M4: ReviewChangesTab — read-only list
**Scope:** Hiển thị pending files + Approve/Reject buttons (1 file), no inline diff
**Files:**
- `apps/app/src/react-app/domains/session/panel/review-panel.tsx` (update)
- `apps/app/src/react-app/domains/session/panel/review-changes-tab.tsx` (new)
- `apps/app/src/react-app/domains/session/panel/review-pending-row.tsx` (new)

**Race condition fix (rev 2):**
- Store thêm field: `pendingMutationIds: Set<string>` (snapshotId đang trong mutation)
- Approve/Reject button: `disabled` khi `pendingMutationIds.has(snapshotId)`
- Clear sau khi mutation settle (success hoặc error)
- Visual feedback: spinner nhỏ trên row đang mutate
- KHÔNG block toàn list — chỉ row cụ thể

**Test trên app:**
1. Mở Review tab → thấy danh sách pending files
2. Mỗi row: file path, +X -Y, AI edit time
3. Empty state: "No pending changes"
4. Click Approve 1 file → confirm → approve → file rời list + toast
5. Click Reject 1 file → confirm → reject → file rời list + toast
6. Verify file content sau reject (mở Preview, check về pre-AI)
7. **Click Approve nhanh trên 2 file khác nhau** → cả 2 mutation parallel, mỗi row có spinner riêng, cả 2 thành công
8. **Click Approve 2 lần trên cùng 1 file** → lần 2 button disabled, không có double-request

**Pass:** Single file approve/reject hoạt động đúng, race condition handled

---

### M5: Inline diff + bulk actions
**Scope:** Expand file xem diff inline + Approve all / Reject all
**Files:**
- `apps/app/src/react-app/domains/session/panel/review-changes-tab.tsx` (update)
- `apps/app/src/react-app/domains/session/panel/review-approve-dialog.tsx` (new)
- `apps/app/src/react-app/domains/session/panel/review-panel.tsx` (update)

**Bulk transaction strategy (rev 2) — Best-effort:**
- Server: `approveAll(snapshotIds)` chạy `Promise.allSettled` thay vì `Promise.all`
  - Return shape: `{ approvedCount: number, failed: Array<{ snapshotId: string, reason: string }> }`
  - KHÔNG rollback nếu 1 file fail (đã quyết ở Q2)
  - Document rõ trong API: "best-effort, no transaction, partial success expected"
- Client: optimistic update
  - Trước khi gọi API: mark tất cả rows là "approving"
  - Sau khi nhận response: remove rows thành công, keep rows failed + show inline error
  - Toast summary: "Approved 5/7. 2 failed: [file1.ts, file2.ts]"
- Retry button cho failed files (dùng same endpoint, snapshotIds = failed list)

**Inline diff (rev 2):**
- Lazy load: chỉ fetch `useFileDiff` khi user click expand row
- Cache theo `filePath` trong TanStack Query (`staleTime: 30s`)
- File size warning: nếu `size > 1_000_000` (1MB) → show warning "Large file, diff may be slow" + render virtualized

**Test trên app:**
1. Click expand 1 file → hiện inline diff (giống ảnh: code với +/- highlighting)
2. Click "Approve all" → confirm → bulk approve → tất cả rời list
3. Click "Reject all" → confirm → bulk reject
4. Partial success: 1 file fail → toast warning "5/7 approved", 2 file failed vẫn trong list với retry button
5. **Diff lazy load**: mở DevTools Network, expand 1 file → thấy 1 request `/diff`, expand file khác → thấy request khác, KHÔNG fetch hết lúc mount
6. Large file > 1MB → show warning

**Pass:** Diff render đúng, bulk actions best-effort OK, lazy diff, partial success handled

---

### M6: ReviewHistoryTab — timeline
**Scope:** Tab History với timeline agent snapshots + status filter
**Files:**
- `apps/app/src/react-app/domains/session/panel/review-history-tab.tsx` (new)
- `apps/app/src/react-app/domains/session/panel/review-snapshot-item.tsx` (new)

**Pagination (rev 2) — "Load more" button:**
- Server endpoint: `GET /workspace/:id/agent-snapshots?cursor=<nextCursor>&limit=50&status=<filter>`
- Response: `{ items: OpenworkFileSnapshot[], nextCursor: string | null }`
- Client `useAgentSnapshots` hook:
  - `useInfiniteQuery` từ TanStack Query
  - `fetchNextPage()` triggered bởi "Load more" button click
  - Button ẩn khi `!hasNextPage`
- Limit mặc định: 50 items/page
- Status filter reset về page 1 khi đổi filter

**Test trên app:**
1. Click History tab → thấy timeline snapshots (50 đầu tiên)
2. Default filter = "All" → hiện tất cả
3. Dropdown filter → "Pending only" / "Approved only" → list filter đúng, reset về page 1
4. Mỗi snapshot: status badge, time, +X -Y, snapshot ID
5. File có > 50 snapshots → "Load more" button xuất hiện, click → load thêm 50
6. Hết data → button ẩn, show "End of history"

**Pass:** Timeline + filter + pagination hoạt động

---

### M7: ReviewDiffTab — full diff viewer
**Scope:** Tab Diff với file picker + ref selector + full DiffViewer
**Files:**
- `apps/app/src/react-app/domains/session/panel/review-diff-tab.tsx` (new)
- Reuse `DiffViewer` từ `artifacts/viewers/diff-viewer`

**Performance (rev 2) — large file handling:**
- Lazy load: fetch diff content chỉ khi user mở Diff tab (KHÔNG fetch lúc mount Changes tab)
- File size check: nếu `size > 1_000_000` (1MB) → show warning "Large file (~X MB). Diff may be slow to render."
- Truncation: nếu diff content > 5000 dòng → show first 5000 + banner "Diff truncated. Showing 5000/N lines. [View full]"
- Virtualization: nếu `DiffViewer` chưa support virtualization → add via `@tanstack/react-virtual` hoặc existing lib trong app
- Reuse `useFileDiff` hook từ M2 (cùng cache)

**Test trên app:**
1. Click Diff tab → thấy file picker + ref selectors
2. File picker default = pending file đầu tiên
3. From = "Pre-AI snapshot" → To = "Current" → diff render đúng
4. Mode toggle: Unified / Split
5. File binary → message "Binary file — diff not available"
6. Click "View full diff" ở Changes tab → switch sang Diff tab + pre-fill file
7. File > 1MB → warning hiển thị
8. Diff > 5000 dòng → truncation banner + "View full" button
9. **Performance**: scroll diff 1000 dòng → không lag (verify bằng DevTools Performance tab)

**Pass:** Diff viewer hoạt động đầy đủ, large file handled, performance OK

---

### M8: Badge trên Review tab
**Scope:** Badge số pending trên Review button
**Files:**
- `apps/app/src/react-app/domains/session/panel/right-panel.tsx` (update)

**Pulse animation spec (rev 2):**
- CSS: `animate-pulse` (Tailwind built-in) hoặc custom keyframes `pulse-amber`
- Trigger condition: `!seen && fileCount > 0`
- Stop condition: user click mở Review tab → call `markSeen(sessionId)` → set `seen = true` → remove `animate-pulse` class
- Re-trigger: khi có pending mới (so sánh `latestAt` với `lastSeenAt`) → set `seen = false` → pulse trở lại
- Color: amber-500 background, white text (contrast ratio > 4.5:1)
- Position: top-right corner of Review tab button, absolute
- Accessible: `aria-label={`${fileCount} pending AI edits`}`

**Test trên app:**
1. Trigger AI edit → badge xuất hiện trên Review tab với số (vd "3")
2. Badge màu amber, có pulse animation khi mới
3. Click Approve 1 file → badge giảm (3 → 2)
4. Approve all → badge về 0 → ẩn
5. Có pending mới sau khi đã seen → badge re-appear + pulse
6. Click Review tab → pulse stop, `aria-label` đúng
7. **Accessibility**: badge có role="status" hoặc aria-live="polite" để screen reader announce

**Pass:** Badge update realtime theo pending count, pulse trigger/stop đúng, a11y OK

---

### M9: Cleanup — xóa AgentReviewBanner cũ
**Scope:** Xóa per-file banner cũ, chuyển hết approval flow qua Review tab
**Files:**
- `apps/app/src/react-app/domains/session/artifacts/agent-review-banner.tsx` (delete)
- `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` (update)
- `apps/app/src/react-app/domains/session/artifacts/hooks/use-agent-snapshot.ts` (delete)

**Pre-cleanup checklist (rev 2):**
- `rg "useAgentSnapshot\b" apps/app/src` → list tất cả usage
- `rg "AgentReviewBanner" apps/app/src` → list tất cả import
- Nếu có usage ngoài `agent-review-banner.tsx` → update trước (chuyển sang `usePendingApprovals`)
- Sau khi grep sạch → mới delete files
- Run `pnpm tsc --noEmit` sau delete để verify không có dead import

**Test trên app:**
1. Mở 1 file có agent snapshot → KHÔNG còn banner per-file
2. Approve flow chỉ đi qua Review tab
3. Verify không có console error, không có dead imports
4. `pnpm tsc --noEmit` pass
5. `pnpm build` pass

**Pass:** Banner cũ xóa sạch, không còn fallback path, type check OK

---

### M10: Polish + final smoke
**Scope:** Edge cases, error handling, toast messages, keyboard shortcuts, tests, i18n, a11y
**Files:**
- Tất cả files trong Review feature
- New: `apps/app/src/react-app/domains/session/panel/__tests__/` (test files)

**Automated tests (rev 2):**
- **Server unit tests** (`apps/app/src/server/__tests__/snapshot-store.test.ts`):
  - `approveSnapshot` mark status đúng
  - `rejectSnapshot` restore content từ `parentSnapshotId`
  - `approveAll` best-effort return shape đúng
  - Edge case: `parentSnapshotId = null` → reject return error
- **Client hook tests** (`apps/app/src/react-app/domains/session/panel/__tests__/use-pending-approvals.test.ts`):
  - Polling fires đúng interval
  - Pause khi `document.hidden`
  - `useFileDiff` dùng `parentSnapshotId` KHÔNG phải `snapshotId`
- **Integration test** (`useFileDiff.integration.test.ts`):
  - Mock server → verify hook call đúng params
- Test runner: `vitest` (check `package.json` trước; nếu chưa có → add)

**i18n (rev 2):**
- Check `apps/app/src/react-app/i18n/` hoặc `apps/app/src/app/locales/` xem có lib không
- Tất cả user-facing strings trong Review feature phải dùng `t("review.changes.title")` etc.
- Default fallback: English
- Nếu KHÔNG có i18n lib → tạo minimal `t()` helper với constants map, defer full i18n setup

**Accessibility audit (rev 2):**
- Tab order: Tab/Shift+Tab đi qua Changes → History → Diff → file picker → action buttons
- Focus management: khi mở Review tab → focus vào Changes tab content (KHÔNG focus vào button)
- ARIA labels: mỗi tab có `aria-label`, badge có `aria-live="polite"`, buttons có accessible names
- Keyboard: `⌘⌥3` switch Review tab, `↑/↓` di chuyển giữa rows, `Enter` approve focused row, `Esc` close dialog
- Color contrast: verify bằng axe-core hoặc manual check
- Screen reader: test bằng VoiceOver (macOS) hoặc NVDA

**Performance (rev 2):**
- Polling pause khi `document.hidden` (đã add ở M2)
- React DevTools Profiler: render time < 16ms cho mỗi row trong list 50 items
- TanStack Query cache: staleTime 10s cho pending list, 30s cho diff content

**Error boundaries (rev 2):**
- Đã add ở M3
- Verify fallback UI có action "Reload Review" (reset state + re-fetch)

**Test trên app:**
1. Network error khi Approve → toast error, retry button, file vẫn pending
2. Snapshot expired khi Reject → toast error
3. Keyboard shortcut `⌘⌥3` → switch Review tab
4. Toast messages rõ ràng, có action undo trong 5s
5. Loading states (skeleton) khi fetch
6. Empty states đầy đủ cho mọi tab
7. Accessibility: tab order, aria-labels, focus management, keyboard nav
8. **Regression test:** toàn bộ flow cũ (Files, Preview, Browser, Settings) vẫn hoạt động
9. Type check: `pnpm tsc --noEmit` pass
10. Build: `pnpm build` pass
11. **Unit tests pass:** `pnpm test` (hoặc `vitest run`)
12. **i18n audit:** grep hard-coded strings trong Review feature → 0 hits
13. **Polling pause:** switch tab, verify Network tab im lặng

**Pass:** Production-ready, không có bug blocker, tests pass, a11y OK

---

## Files modified summary

| File | Action | Milestone |
|------|--------|-----------|
| `apps/server/src/server/...` (snapshot store + router) | Thêm `status` field + 5 endpoints | M1 |
| `apps/app/src/app/lib/openwork-server.ts` | Thêm types + 5 methods | M1 |
| `apps/app/src/react-app/domains/session/panel/review-store.ts` | New — Zustand store | M2 |
| `apps/app/src/react-app/domains/session/artifacts/hooks/use-pending-approvals.ts` | New — poll + mutations | M2 |
| `apps/app/src/react-app/domains/session/artifacts/hooks/use-agent-snapshots.ts` | New — list agent snapshots | M2 |
| `apps/app/src/react-app/domains/session/artifacts/hooks/use-file-diff.ts` | New — diff content | M2 |
| `apps/app/src/react-app/shell/ui-state-store.ts` | Thêm `"review"` vào `SidePanelItem` | M3 |
| `apps/app/src/react-app/domains/session/panel/right-panel.tsx` | Thay `browser` → `review` + render ReviewPanel + badge | M3, M8 |
| `apps/app/src/react-app/domains/session/panel/review-panel.tsx` | New — main component | M3, M4, M5 |
| `apps/app/src/react-app/domains/session/chat/session-page.tsx` | Thêm Browser rail button + handler | M3 |
| `apps/app/src/react-app/domains/session/panel/review-changes-tab.tsx` | New — pending list | M4, M5 |
| `apps/app/src/react-app/domains/session/panel/review-pending-row.tsx` | New — 1 row component | M4 |
| `apps/app/src/react-app/domains/session/panel/review-approve-dialog.tsx` | New — confirm modal | M5 |
| `apps/app/src/react-app/domains/session/panel/review-history-tab.tsx` | New — timeline | M6 |
| `apps/app/src/react-app/domains/session/panel/review-snapshot-item.tsx` | New — 1 snapshot row | M6 |
| `apps/app/src/react-app/domains/session/panel/review-diff-tab.tsx` | New — full diff viewer | M7 |
| `apps/app/src/react-app/domains/session/artifacts/agent-review-banner.tsx` | Delete | M9 |
| `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` | Bỏ mount `AgentReviewBanner` | M9 |
| `apps/app/src/react-app/domains/session/artifacts/hooks/use-agent-snapshot.ts` | Delete | M9 |

---

## API design

### Data model

```ts
type OpenworkFileSnapshotStatus = "pending" | "approved" | "rejected";

type OpenworkFileSnapshot = {
  id: string;
  path: string;
  createdAt: number;
  size: number;
  trigger: "auto" | "manual" | "agent";
  status?: OpenworkFileSnapshotStatus;  // chỉ áp dụng cho trigger = "agent"
  parentSnapshotId?: string | null;     // pre-AI snapshot (null = no parent, file đầu tiên trong session)
  content?: string;
};

type WorkspacePendingApproval = {
  filePath: string;
  snapshotId: string;
  parentSnapshotId: string | null;      // nullable: snapshot đầu tiên không có parent
  createdAt: number;
  addedLines: number;
  removedLines: number;
  diffSummary: string;
};
```

**Migration semantics (rev 2):**
- Existing snapshots trong DB: `status = undefined`, `parentSnapshotId = undefined` (KHÔNG backfill)
- Old snapshots KHÔNG xuất hiện trong `GET pending-approvals` (chỉ filter `status = "pending"`)
- Old snapshots VẪN xuất hiện trong `GET agent-snapshots` với status undefined (UI hiển thị "Legacy")

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/workspace/:id/pending-approvals` | List pending files |
| `POST` | `/workspace/:id/approvals/:snapshotId/approve` | Approve 1 file |
| `POST` | `/workspace/:id/approvals/:snapshotId/reject` | Reject 1 file (restore + mark) |
| `POST` | `/workspace/:id/approvals/approve-all` | Bulk approve (best-effort) |
| `POST` | `/workspace/:id/approvals/reject-all` | Bulk reject (best-effort) |
| `GET` | `/workspace/:id/agent-snapshots?cursor=&limit=&status=` | List agent snapshots với filter + pagination |

### Server logic

**`approveSnapshot(snapshotId)`**: mark `status = "approved"`, KHÔNG thay đổi file content (git sẽ pick up)

**`rejectSnapshot(snapshotId)`**:
- Nếu `parentSnapshotId === null || undefined` → return `{ ok: false, code: "NO_PARENT_SNAPSHOT", message: "Cannot reject: no pre-AI snapshot available" }`
- Nếu OK: restore content từ `parentSnapshotId` + mark `status = "rejected"`

**`approveAll(snapshotIds)`**: `Promise.allSettled` parallel `approveSnapshot` cho từng id, return `{ approvedCount: number, failed: Array<{ snapshotId: string, reason: string }> }`. **Best-effort, KHÔNG transaction, KHÔNG rollback.**

**`listAgentSnapshots({ cursor, limit, status })`**:
- `limit` default = 50, max = 200
- `status` optional: `"pending" | "approved" | "rejected"` (filter exact match; missing status = return all)
- Cursor-based pagination: response `{ items, nextCursor }` where `nextCursor = null` = end
- Sort: `createdAt DESC` (newest first)

**Verify before M1 (rev 2):**
- `GET /workspace/:id/files/:path/diff?from=:from&to=:to` endpoint phải support `to = "current"` (current working tree)
- Nếu chưa có → thêm vào scope M1
- Nếu shape response khác (`result.diff` vs `result.unifiedDiff` etc.) → adjust `useFileDiff` hook tương ứng

---

## Client state (Zustand)

**File:** `review-store.ts`

```ts
type ReviewStore = {
  // Session tracking cho badge
  pendingBySession: Record<string, { fileCount: number; latestAt: number; seen: boolean }>;
  setPendingCount: (sessionId: string, count: number, latestAt: number) => void;
  markSeen: (sessionId: string) => void;
  clearPending: (sessionId: string) => void;

  // UI state (per session)
  activeInnerTabBySession: Record<string, "changes" | "history" | "diff">;
  setActiveInnerTab: (sessionId: string, tab: ...) => void;

  activeFileBySession: Record<string, string | null>;
  setActiveFile: (sessionId: string, filePath: string | null) => void;

  historyStatusFilterBySession: Record<string, "all" | "pending" | "approved" | "rejected">;
  setHistoryStatusFilter: (sessionId: string, filter: ...) => void;

  expandedFilesBySession: Record<string, Set<string>>;
  toggleExpanded: (sessionId: string, filePath: string) => void;
};
```

**Badge logic:**
- Tab `Review` button hiển thị badge số `fileCount` (amber, pulse) khi `fileCount > 0`
- Auto-mark `seen = true` khi user mở Review tab
- Re-mark `seen = false` khi có pending mới (sau khi đã seen)

---

## Edge cases

| Case | Behavior |
|------|----------|
| User refresh trang khi đang ở Review | Pending list re-fetch, state restore từ store (in-memory) |
| Network error khi Approve | Toast error, file vẫn pending. Retry button. |
| Approve nhưng file đã bị user manual edit | Server vẫn mark approved, working tree giữ manual edit. Không conflict. |
| Reject nhưng file không còn pre-AI snapshot | Toast error "Snapshot expired, cannot reject. File left as-is." |
| Approve all với 1 file fail | Partial success toast: "5/7 approved. Failed: file1.ts" |
| User approve rồi muốn revert | Phải dùng git (đã vào working tree). Review không quản lý nữa. |
| AI edit file 2 lần liên tiếp | Snapshot mới ghi đè, UI chỉ show 1 row (latest). |

---

## Open questions — RESOLVED (rev 2)

| # | Câu hỏi | Decision | Rationale |
|---|---------|----------|-----------|
| 1 | Migration strategy cho `OpenworkFileSnapshot` | **(a) Default `status = undefined`** | An toàn nhất. Old snapshots không có `parentSnapshotId` → không thể reject anyway, chỉ hiển thị trong History là "legacy". Không cần touch data. |
| 2 | Approve-all transaction | **(b) Best-effort** | Match UX: user thấy "5/7 approved" thì biết phải retry cái fail. All-or-nothing với N file = 1 lỗi rollback N-1 thì frustrate. |
| 3 | History pagination | **(b) "Load more" button** | Infinite scroll trong panel nhỏ + dev tool vibe = awkward. Page numbers = overkill. Load-more = explicit, simple, debug-able. |
| 4 | Polling vs WebSocket | **(a) Polling 10s** + pause khi `document.hidden` | Server chưa có WS infra, polling đủ tốt cho workflow này. Pause khi tab hidden = tiết kiệm bandwidth. |
| 5 | i18n | **(a) Dùng i18n lib hiện có** + fallback English nếu không có | Cần check trong M1 setup. Nếu không có → tạo minimal `t()` helper. |
| 6 | Automated tests | **(a) Unit + integration tests M10** | Bulk approve + race condition = bug-prone. Tối thiểu test core hooks + server logic. |

---

## Timeline estimate (rev 2 — đã bao gồm fixes)

| Milestone | Effort | Notes |
|-----------|--------|-------|
| M1 | 3-4h | +migration script, +verify diff endpoint, +nullable parent |
| M2 | 2-3h | +diff logic fix, +polling pause on hidden |
| M3 | 1.5h | +ErrorBoundary, +conflict resolution doc |
| M4 | 2-3h | +per-file loading state |
| M5 | 2-3h | +best-effort server logic, +optimistic + rollback, +lazy diff |
| M6 | 2h | +pagination with useInfiniteQuery |
| M7 | 2-3h | +lazy load, +large file warning, +virtualization check |
| M8 | 0.5h | +pulse animation spec |
| M9 | 0.5h | +grep checklist, +type check |
| M10 | 3-4h | +unit tests, +integration tests, +i18n audit, +a11y audit, +polling pause verify |
| **Tổng** | **~19-25h** (~3-4 ngày làm việc) |

> Effort tăng ~30% so với plan gốc vì fixes từ review. Đổi lại ít bug hơn về sau.
