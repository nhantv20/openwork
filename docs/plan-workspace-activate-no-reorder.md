# Plan: Workspace Activate — Stop Reordering Sidebar

> Status: Implemented
> Owner: Mavis (Mavis, M3)
> Scope: Server `POST /workspaces/:id/activate` no longer prepends the activated workspace to `config.workspaces`. The active selection now lives in a separate `config.activeWorkspaceId` field so the sidebar keeps a stable position for each project.

---

## 0. Tóm tắt bằng 1 câu

Tách `active workspace` ra khỏi `workspaces[0]` — activate handler giờ chỉ set `config.activeWorkspaceId`, không reorder list. Sửa kèm 3 e2e tests expectations, thêm 1 test mới lock behavior "activate does not reorder", persist `activeWorkspaceId` vào config file.

---

## 1. Bối cảnh

### 1.1. Vấn đề user quan sát
List project `[A, B, C]` → click C → `[C, A, B]`. Lặp lại nhiều lần, list "lung tung" — user không nhớ được vị trí các project.

### 1.2. Nguyên nhân gốc
Server lưu "active workspace" **implicitly** qua `config.workspaces[0]`:

- `POST /workspaces/:id/activate` (apps/server/src/routes/workspaces.ts:469 cũ) prepend workspace được click lên đầu.
- `GET /workspaces` (apps/server/src/routes/core.ts:323 cũ) trả `activeId = config.workspaces[0]?.id`.
- Mỗi lần user click workspace trong sidebar, app gọi activate (`session-route.tsx:1793` của client) → server prepend → list reorder.

Đây là bug từ thiết kế: "active state" nên là 1 field riêng, không phải implicit state qua index 0.

### 1.3. Quyết định kiến trúc
- Thêm `config.activeWorkspaceId?: string` vào `ServerConfig`.
- Activate handler: bỏ prepend, set `config.activeWorkspaceId = workspace.id`.
- GET handlers: trả `activeId = resolveActiveWorkspaceId(config)`, fallback về `workspaces[0]?.id` nếu field chưa set (back-compat).
- Tạo local/remote workspace: vẫn prepend (user vừa tạo, muốn thấy ngay), set `activeWorkspaceId` luôn.
- DELETE workspace: nếu xóa active → fallback về `workspaces[0]?.id` (cleanup).
- Persist `activeWorkspaceId` trong config file.
- Đọc `activeWorkspaceId` từ config file khi boot (optional, fallback nếu thiếu).

---

## 2. Files changed

| File | Thay đổi |
|---|---|
| `apps/server/src/types.ts` | Thêm `activeWorkspaceId?: string` vào `ServerConfig` |
| `apps/server/src/config.ts` | Thêm `activeWorkspaceId` vào `FileConfig`; wire từ file vào `ServerConfig` |
| `apps/server/src/routes/workspaces.ts` | Helper `resolveActiveWorkspaceId`; sửa activate (bỏ prepend); sửa create local/remote (set activeWorkspaceId); sửa DELETE (cleanup); sửa PATCH display-name response; sửa persist function |
| `apps/server/src/routes/core.ts` | Sửa GET `/workspaces` dùng `resolveActiveWorkspaceId` |
| `apps/server/src/workspace-activate.e2e.test.ts` | Update 2 test expectations; thêm helper `readPersistedActiveWorkspaceId`; thêm test mới "activate does not reorder" |

---

## 3. Verification

### 3.1. Type check
```
$ pnpm --filter @openwork/server typecheck
tsc -p tsconfig.json --noEmit
(no output → 0 errors)
```

### 3.2. Tests
```
$ bun test src/workspace-activate.e2e.test.ts
7 pass, 0 fail
- workspace activation > reloads the bound OpenCode engine on activate
- workspace activation > persists activation order only when requested
- workspace activation > activate does not reorder the workspace list  ← NEW
- workspace lifecycle registry > creates server config file when adding a local workspace
- workspace lifecycle registry > does not persist transient local OpenCode runtime fields
- workspace lifecycle registry > creates and persists remote OpenWork workspace records
- workspace lifecycle registry > renames activates and deletes remote records without authorized roots
```

### 3.3. Full server test
```
$ bun test src/
570 pass, 2 skip, 0 fail
Ran 572 tests across 67 files. [12.78s]
```

Không regression nào trong toàn bộ server codebase.

### 3.4. Manual smoke test (cần user xác nhận trên app thật)
1. Tạo 3 workspace A, B, C → list `[A, B, C]`.
2. Click C → list vẫn `[A, B, C]`. C được highlight (active).
3. Click A → list vẫn `[A, B, C]`. A được highlight.
4. Refresh app → list vẫn `[A, B, C]`. Active workspace = A (từ `config.activeWorkspaceId`).
5. Tạo workspace D mới → list `[D, A, B, C]`. D ở đầu + active.
6. Xóa workspace D → list `[A, B, C]`. Active = A (fallback về `workspaces[0]`).

---

## 4. Backwards compatibility

- Config file cũ (không có `activeWorkspaceId`) → server fallback về `workspaces[0]?.id` như cũ. Không breaking.
- Response shape: `activeId` vẫn trả trong tất cả responses. Có thêm persisted `activeWorkspaceId` trong config file khi persist.
- Client không cần thay đổi (vẫn đọc `activeId` từ response).

---

## 5. Risks đã cover

| Risk | Mitigation |
|---|---|
| Config file cũ không có `activeWorkspaceId` | `resolveActiveWorkspaceId` fallback `workspaces[0]?.id` |
| Xóa workspace đang active | DELETE handler cleanup `activeWorkspaceId` về `workspaces[0]?.id` |
| `activeWorkspaceId` refer tới workspace đã bị xóa (state cũ) | `resolveActiveWorkspaceId` check `workspaces.some(id === stored)` |
| Persist function ghi đè field khác | Spread `...parsed` trước, override `workspaces`/`activeWorkspaceId`/`authorizedRoots` |
| E2E test cũ expect prepend | Update 2 test, lock behavior mới trong test riêng |
| Client có cache cũ (`activeId` ≠ `activeWorkspaceId` mới) | Client dùng `activeId` từ response → luôn đúng với server state hiện tại |

---

## 6. Out of scope (deferred)

- UI indicator cho "active workspace" (sidebar có thể có dấu hiệu riêng) — không thay đổi.
- Persist `activeWorkspaceId` cross-platform (den web) — den web đọc `activeId` từ `/workspaces` API, không dùng config file trực tiếp.
- Reorder khi tạo workspace mới (line 314, 420 prepend vẫn còn) — theo intent user, prepend cho "vừa tạo" là hợp lý. Có thể bỏ sau nếu user đổi ý.

---

## 7. Commit suggestion

```
fix(workspace): stop prepending activated workspace to config list

Move active selection from implicit `workspaces[0]` to an explicit
`config.activeWorkspaceId` field. Sidebar no longer reshuffles when the
user clicks a project; the activated workspace is still reported as
active via API responses.

- Server: add `activeWorkspaceId` to `ServerConfig` + `FileConfig`; new
  `resolveActiveWorkspaceId` helper; activate/create/delete handlers
  updated to manage the field without reordering `config.workspaces`.
- Tests: 2 e2e expectations updated, 1 new test locks
  "activate does not reorder".
```
