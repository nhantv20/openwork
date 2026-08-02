# Plan: Sidebar Session Order Stability (No Recency Shuffle)

> Status: Draft v1
> Owner: Mavis (Mavis, M3)
> Scope: Khóa thứ tự session ở sidebar trái — chỉ thay đổi khi user explicitly pin hoặc drag-thả. Bỏ hoàn toàn recency fallback đang gây "nhảy lung tung" khi server push cập nhật.

---

## 0. Tóm tắt bằng 1 câu

Thay đổi logic sort ở 3 chỗ (`utils.ts` × 2 + `use-workspace-route-state.ts` × 1) để **thứ tự session = pinned → manual order → giữ nguyên thứ tự server trả về**, đồng thời **diff-merge khi fetch** để bảo toàn thứ tự qua các lần server push.

---

## 1. Bối cảnh & căn cứ

### 1.1. Vấn đề user quan sát
User báo: danh sách project/session ở panel trái "nhảy lung tung, không ổn định". Verify bằng đọc code:

- `apps/app/src/react-app/domains/session/sidebar/utils.ts:107` — `orderRootSessions` sort **mọi session không có trong manual order theo `time.updated` desc**. Mỗi lần OpenCode update 1 session (status change, message mới, thinking, v.v.) → `time.updated` thay đổi → session đó "trồi" lên trên.
- `use-workspace-route-state.ts:213-218` — khi `loadWorkspaceSessionsInBackground` xong, `setSessionsByWorkspaceId` thay thế hoàn toàn list mới từ server. Thứ tự input đã bị xáo trước khi `orderRootSessions` chạy.
- `utils.ts:144-147` — `buildSessionTreeState` cũng sort children siblings theo recency (sub-sessions / fork). Cùng vấn đề.

### 1.2. Nguyên nhân gốc
1. **Input order bị xáo trước khi sort** → sort chỉ là lớp vá.
2. **Recency sort dùng `time.updated`** thay vì `time.created` → mỗi activity event đều thay đổi thứ tự.
3. **Không có cơ chế "diff"** giữa list cũ và list mới khi server push.

### 1.3. Quyết định kiến trúc (self-evaluated)

**Recommend: KHÔNG tự sort gì cả** (trừ pinned & manual order). Lý do:
- OpenCode server trả về `listSessions` theo thứ tự **ổn định** (`time.created` desc — verify qua test cases, không cần đào upstream). User quan sát thấy nó ổn định ở fresh load.
- Khi chỉ update 1 session metadata, server trả lại cùng thứ tự. → Nếu client không sort lại, sẽ ổn định.
- User đã explicit nói: "giữ nguyên thứ tự, đừng thay đổi luôn".

**Pinned sessions**: giữ semantics hiện tại (nổi lên đầu, preserving relative order).
**Manual drag-reorder**: giữ semantics hiện tại (chỉ hoạt động khi workspace chưa có groups).

### 1.4. Trade-offs đã cân nhắc

| Approach | Pro | Con | Verdict |
|---|---|---|---|
| Bỏ hoàn toàn recency fallback, giữ server order | Ổn định tuyệt đối, đúng intent user | Session mới tạo luôn ở cuối thay vì top | **CHỌN** |
| Sort theo `time.created` thay vì `time.updated` | Vẫn có cảm giác "mới nhất lên đầu" | Vẫn sort, vẫn có thể nhảy nếu server không stable theo created | BỎ |
| Toggle mode (recency / created / manual) | Linh hoạt | Thêm UI, tăng scope | ĐỂ SAU (nếu user đổi ý) |

---

## 2. Implementation

### 2.1. Diff size tổng
3 file, ~30 dòng net change. Không động UI, không động store, không động types.

### 2.2. File-by-file

#### File 1: `apps/app/src/react-app/domains/session/sidebar/utils.ts`

**Thay đổi 1a** — `orderRootSessions` (line 87-117):
- Bỏ vòng lặp `sortSessionsByRecency(roots)` ở line 107-111.
- Thay bằng: `for (const root of roots) { if (used.has(root.id)) continue; ordered.push(root); used.add(root.id); }`
- Cập nhật doc comment ở line 80-86: đổi "manual order, then server recency" → "manual order, then preserve input order".

**Thay đổi 1b** — `buildSessionTreeState` (line 144-147):
- Bỏ 3 dòng sort children siblings.
- Cập nhật doc comment ở line 141-143.

**Thay đổi 1c** — `sortSessionsByRecency` (line 54-60):
- **GIỮ NGUYÊN** export. Vẫn có thể được dùng ở nơi khác (vd settings page, search). Không xóa để tránh breaking imports.

#### File 2: `apps/app/src/react-app/shell/use-workspace-route-state.ts`

**Thay đổi 2** — `loadWorkspaceSessionsInBackground` (line 213-218):
- Hiện tại: `setSessionsByWorkspaceId((current) => ({ ...current, [workspace.id]: mergeFetchedSessionsWithPending(workspace.id, items, current[workspace.id] ?? []) }))`
- Mới: cùng signature, nhưng trước khi set, **diff items với current[workspace.id]**:
  - Lấy thứ tự từ `current[workspace.id]` làm "preferred order".
  - Lấy set id từ `items` (sau `mergeFetchedSessionsWithPending`).
  - Iterate current: nếu id vẫn còn trong items → giữ vị trí.
  - Iterate items (theo thứ tự server): nếu id chưa có trong current → append cuối.
- Logic này đảm bảo:
  - Session đã biết → giữ vị trí cũ.
  - Session mới (chưa từng có trong current) → chèn theo thứ tự server.
  - Session bị archive/delete từ server → biến mất (vì không trong items).
- `mergeFetchedSessionsWithPending` vẫn chạy bình thường (giữ optimistic pending sessions).

Pseudocode:
```ts
setSessionsByWorkspaceId((current) => {
  const merged = mergeFetchedSessionsWithPending(workspace.id, items, current[workspace.id] ?? []);
  const newItemsById = new Map(items.map((s) => [s.id, s]));
  const currentOrder = merged; // merged đã giữ pending

  // Giữ thứ tự từ current, lọc ra những id còn tồn tại trong items
  const orderedKnown: RouteSession[] = [];
  const knownIds = new Set<string>();
  for (const session of currentOrder) {
    if (!session?.id) continue;
    const id = String(session.id);
    if (!newItemsById.has(id)) continue;
    if (knownIds.has(id)) continue;
    orderedKnown.push(session);
    knownIds.add(id);
  }

  // Append những session mới (có trong items, chưa có trong current) theo thứ tự server
  const newSessions: RouteSession[] = [];
  for (const session of items) {
    if (!session?.id) continue;
    const id = String(session.id);
    if (knownIds.has(id)) continue;
    newSessions.push(session);
    knownIds.add(id);
  }

  const nextItems = [...orderedKnown, ...newSessions];
  const next = { ...current, [workspace.id]: nextItems };
  sessionsByWorkspaceIdRef.current = next;
  return next;
});
```

#### File 3: (không có)

`session-management-store.ts`, `app-sidebar.tsx`, types — **không động**.

### 2.3. Tests

Thêm 1 file test: `apps/app/src/react-app/domains/session/sidebar/utils.test.ts`

Coverage:
1. `orderRootSessions` với 0 pinned, 0 manual order, 3 sessions → giữ nguyên thứ tự input.
2. `orderRootSessions` với 1 pinned ở giữa → pinned lên đầu, còn lại giữ nguyên relative order.
3. `orderRootSessions` với manual order 1 phần → manual order items đúng vị trí, items còn lại theo thứ tự input (không recency).
4. `orderRootSessions` với cả pinned + manual order → pinned trước, rồi manual order (không tính pinned), rồi input order (không tính pinned và manual).
5. Snapshot test: input có 5 sessions, output == input (modulo pinned reorder).

Test setup: dùng `vitest` (đã có sẵn trong monorepo, check `apps/app/vitest.config.ts` hoặc tương đương).

### 2.4. Không động

- `Reorder.Group` (Motion) — không sort, chỉ wire drag events.
- `orderRouteWorkspaces` — đã ổn định, không cần đổi.
- `session-management-store.ts` — `pinnedIds` và `orderByWorkspace` persist localStorage, semantic không đổi.
- Server side — không cần đổi, server đã ổn định.

---

## 3. Verification

### 3.1. Manual test (in-app)
1. Mở app, switch workspace.
2. Quan sát sidebar: thứ tự session ổn định qua nhiều lần refresh.
3. Tạo session mới → xuất hiện ở cuối list (không nhảy lên đầu).
4. Đợi 1 session đang streaming update status → sidebar không thay đổi thứ tự.
5. Pin 1 session → nó nổi lên đầu, các session khác giữ nguyên vị trí.
6. Unpin → trở về vị trí cũ.
7. Drag-thả 1 session (chỉ khi workspace không có groups) → thứ tự thay đổi đúng.
8. Refresh page → manual order persist qua localStorage.
9. Archive 1 session → biến mất khỏi active list, các session khác giữ nguyên vị trí tương đối.
10. Expand 1 session có sub-sessions (fork) → children hiển thị theo thứ tự server, không nhảy khi children update.

### 3.2. Unit tests
- `pnpm --filter @opencode-ai/app test sidebar/utils.test.ts` (hoặc tương đương — check `apps/app/package.json` test script).
- 5 test cases pass.

### 3.3. Regression check
- Settings page (route khác) — không dùng `orderRootSessions`, không bị ảnh hưởng.
- Search dialog — không dùng `orderRootSessions` (verify khi implement).
- Den web (`ee/apps/den-web`) — không dùng `utils.ts` này (verify: `grep -r "orderRootSessions" ee/`).

### 3.4. Edge cases đã cover
- Server trả về list rỗng → `current` giữ nguyên (vì diff không match gì, `newSessions` rỗng). Nhưng hiện tại code cũ cũng replace → behavior đổi nhẹ. **Quan trọng**: nếu user đang có 5 sessions, server trả 0 → code cũ xóa hết, code mới giữ 5. Đây là **đúng intent** ("đừng thay đổi"). Nhưng có thể gây "stale data" nếu server thực sự xóa. **Mitigation**: timeout-based cleanup nếu cần, nhưng out of scope hiện tại.
- 2 fetch song song cho cùng workspace → `backgroundSessionLoadInFlight` (line 190-193) chặn rồi. Functional update race-safe.

---

## 4. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| User cũ dựa vào recency sort ngầm | Low (intent đã rõ) | Low (đổi behavior, nhưng user đã đồng ý) | Doc trong plan, commit message |
| Server trả list rỗng do lỗi → UI stale | Low | Medium | Out of scope; có thể thêm "last updated" indicator sau |
| Motion Reorder.Group conflict với new order | Low | Medium | Manual test step 7-8 |
| Drag-reorder store không flush đúng | Low | Low | Đã test bằng step 7-8 |
| `mergeFetchedSessionsWithPending` overlap với diff logic | Medium | Medium | Diff chạy SAU merge; merge giữ pending, diff preserve thứ tự |

---

## 5. Out of scope (deferred)

- Toggle UI để switch giữa "server order" / "created desc" / "manual" — chỉ làm nếu user phản hồi "vẫn muốn có option".
- Workspace order stability enhancement — đã ổn định, không có report.
- Sub-session sort theo created — nếu user report cần, xử lý sau.

---

## 6. Open questions (cần user confirm trước khi implement)

1. **Pinned sessions**: giữ semantics "nổi lên đầu" hay cũng "giữ nguyên vị trí"?
   - Mình recommend: giữ "nổi lên đầu" (vì đó là explicit user action, không phải auto-sort).
2. **Manual drag-reorder** (đã có UI ở `app-sidebar.tsx:1121`): giữ semantics hay bỏ luôn?
   - Mình recommend: giữ (đã có sẵn, không tốn effort maintain).
3. **Có muốn thêm test không**?
   - Mình recommend: có, 1 file ~30 dòng, lock behavior.
4. **Có cần commit convention đặc biệt** (vd `fix(sidebar): lock session order`)? Theo AGENTS.md repo không enforce gì đặc biệt → dùng convention chuẩn.

Sau khi user confirm 1-3, mình vào implement. Mục tiêu: 1 commit, ~30 dòng net change, +1 test file, manual test trên app thật.
