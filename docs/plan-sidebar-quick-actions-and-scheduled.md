# Plan: Sidebar Quick-Action Group + Scheduled Tasks

> Status: Draft v1
> Owner: Mavis (Mavis, M3)
> Scope: 1) Thêm "Quick Actions" group trên sidebar (New task / Search / Scheduled).
> 2) Thiết kế chức năng Scheduled tasks (cron) end-to-end.
> Reference: hình mockup user gửi + `WBS.md` Phase 3 (~38h) + codebase hiện tại của OpenWork.

---

## 0. Tóm tắt bằng 1 câu

Thêm một **Quick Actions** group cố định ở đầu sidebar (New task, Search, Scheduled) và một
backend + UI scheduled-tasks (cron) thật sự chạy được trong OpenWork server, theo đúng scope
đã liệt kê trong `WBS.md` Phase 3.

---

## 1. Bối cảnh & căn cứ

### 1.1. Mockup user gửi
Một group "Quick Actions" nằm trên cùng của sidebar (khoanh đỏ), 5 item:
- New task (icon dấu `+` trong vòng tròn)
- Search (icon kính lúp)
- Skills (icon tài liệu)
- Scheduled (icon đồng hồ)
- Connect Mobile (icon sạc)

Phần dưới là sidebar hiện tại (Pinned, Scheduled section, Projects, …).

### 1.2. Codebase hiện tại
- Sidebar component: `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx`
  - Phần `SidebarHeader` (line 753-771) hiện chỉ có 1 button "Search sessions" mở dialog
    `onOpenSessionSearch` (Cmd/Ctrl+Shift+F) — đây là "Search" trong mockup.
  - "New task" đã có logic ở mỗi workspace (line 1046, 1193) gọi
    `ctx.onCreateTaskInWorkspace(workspaceId)` — mình sẽ tách thành action global (không
    cần workspace) dùng lại cùng handler.
  - **Chưa có** "Skills", "Scheduled", "Connect Mobile" — đây là 3 action mới hoàn toàn.
- `WBS.md` line 86-102 đã định nghĩa scope "Phase 3: Scheduled Tasks (Cron)" — **chưa làm**
  gì, ước lượng 38h, port từ AionUi.
- i18n: có sẵn 10 locale (`en`, `vi`, `ja`, `zh`, …) — mọi text mới phải thêm vào cả 10 file.
- `settings.scheduler_plugin_unavailable` (en.ts:1195) đã tồn tại — gợi ý scheduler plugin
  là pattern được chấp nhận.

### 1.3. Quyết định kiến trúc (recommend)
Mình recommend chia thành 2 milestone tách biệt:

- **Milestone 1 — Sidebar Quick Actions group (~1-2 ngày):**
  Item "Scheduled" trỏ tới Settings page "Scheduled tasks" (placeholder có sẵn
  `scheduler_plugin_unavailable`). Hai item "Skills" và "Connect Mobile" hiển thị nhưng
  chưa wire (giống mockup) hoặc wire tạm sang điều hướng có sẵn.
- **Milestone 2 — Scheduled Tasks thật (~5-7 ngày):**
  DB + cron runner + REST + UI page + execute engine, theo WBS Phase 3.

Lý do tách: Milestone 1 có thể ship ngay, validate UX; Milestone 2 là phần "công phu"
nên làm sau khi UI menu đã có chỗ đứng.

---

## 2. Milestone 1 — Sidebar Quick Actions group

### 2.1. Mục tiêu
Thêm 1 `SidebarGroup` ở trên cùng sidebar, chứa tối đa 5 button (tùy context hiển thị).
Các action đều hoạt động với workspace hiện đang select (ngoại trừ Search/Connect Mobile).

### 2.2. UI behavior
| Item | Icon | Action | Khi workspace chưa có? | Disabled khi |
|------|------|--------|------------------------|--------------|
| New task | `Plus` (trong vòng tròn) | Tạo task mới ở `selectedWorkspaceId` | Nếu `selectedWorkspaceId=""` → bật modal "Add workspace" (`onOpenCreateWorkspace`) | `newTaskDisabled` (đang có sẵn) |
| Search | `Search` | Mở `sessionSearchOpen` dialog | luôn khả dụng | — |
| Skills | `FileText` / `Sparkles` | Mở Settings > Plugins & Skills (route có sẵn) | luôn khả dụng | — |
| Scheduled | `Clock` | Mở Settings > Scheduled tasks page | luôn khả dụng | hiển thị badge "Coming soon" nếu plugin chưa install (dùng `scheduler_plugin_unavailable`) |
| Connect Mobile | `Battery` / `Smartphone` | Mở Settings > Remote Access (nơi có WebUI QR) | luôn khả dụng | "Coming soon" nếu chưa có plugin |

Mockup có 5 item; đề xuất giữ đúng 5 để khớp hình, dù "Skills"/"Connect Mobile" có thể là
wireframe tương lai. Mình sẽ wire tạm sang navigation có sẵn để user click được.

### 2.3. Vị trí code
- `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx`
- Tạo file mới `apps/app/src/react-app/domains/session/sidebar/quick-actions-group.tsx`
  (component thuần, props-driven) để dễ test.
- Props mới trên `AppSidebar`:
  - `onOpenSkills?` — mặc định trỏ sang navigation tới `/settings/plugins` (nếu routing
    system có sẵn; nếu không thì mở notification "Navigate to Settings → Plugins").
  - `onOpenScheduled?` — mặc định trỏ sang `/settings/scheduled`.
  - `onOpenConnectMobile?` — mặc định trỏ sang `/settings/remote-access`.
- `session-route.tsx` wire 3 callback trên trong block `sidebar={{...}}` (đã có
  `onOpenSessionSearch` ở line 1860 — copy pattern đó).

### 2.4. Tasks
| # | Task | Effort | Output |
|---|------|--------|--------|
| 1.1 | Tạo `QuickActionsGroup` component + test render với 5 item | 2h | file mới + 1 snapshot test |
| 1.2 | Mount vào `AppSidebar` giữa `SidebarHeader` (Search cũ) và `LazyMotion` | 1h | edit `app-sidebar.tsx` |
| 1.3 | Thêm 3 callback + wire từ `session-route.tsx` | 1h | edit `session-route.tsx` |
| 1.4 | Thêm i18n key vào 10 locale (`sidebar.quick_actions.*`) | 1h | edit 10 file locale |
| 1.5 | Verify: dev build + click từng item + check state | 1h | manual + screenshot |
| 1.6 | Update `AGENTS.md` / WBS nếu cần (check-in note) | 0.5h | docs |

**Subtotal: ~6.5h (~1 ngày)**

### 2.5. Tiêu chí xong
- Click mỗi item đều có feedback (mở dialog / navigate / show toast).
- Search cũ (Cmd+Shift+F) vẫn hoạt động, không bị trùng logic.
- Test render: 5 button hiện đúng thứ tự, đúng icon.
- Không phá vỡ flow create task theo workspace.

### 2.6. Implementation deviations + post-review fixes (recorded 2026-07-12)

Sau khi self-review lần 2, mình đã fix 3 điểm so với spec ban đầu:

1. **No-workspace New task → mở `onOpenCreateWorkspace`** (thay vì disable + tooltip).
   Click vào New task khi chưa chọn workspace sẽ mở luôn modal "Add workspace" theo
   đúng plan §2.2. Tooltip vẫn còn (`title=` attr) để giải thích hành vi cho user.
   Component cần thêm prop bắt buộc `onOpenCreateWorkspace: () => void`.
2. **Per-button mount guard** (thay vì "all-or-nothing"). Group chỉ yêu cầu
   `onOpenSearch` để render. 3 button M2 (`onOpenSkills/Scheduled/ConnectMobile`)
   chỉ render khi callback tồn tại → nếu sau này M2 chưa sẵn sàng, Search shortcut
   vẫn còn.
3. **Badge "Soon" hardening**: thêm `data-testid="quick-action-coming-soon"` để
   test count qua attribute (không phụ thuộc locale), `shrink-0 whitespace-nowrap`
   để không bị truncate + thêm `title=` tooltip dùng key `quick_actions_coming_soon_hint`
   cho hover hint đầy đủ (đặc biệt quan trọng với locale Trung/Hàn dịch dài).

Test count sau fix: **7 test pass** (1 thay + 1 mới cho per-button guard).

---

## 3. Milestone 2 — Scheduled Tasks (Cron) — full design

### 3.1. Mục tiêu
User có thể tạo 1 task định kỳ (cron expression + prompt), hệ thống tự động chạy prompt đó
trong workspace đã chọn đúng lịch, kết quả hiện như 1 session mới.

### 3.2. Data model
Bảng `scheduled_jobs` (SQLite, server-side):
```sql
id TEXT PRIMARY KEY,              -- ULID
workspace_id TEXT NOT NULL,        -- FK → workspaces
name TEXT NOT NULL,
prompt TEXT NOT NULL,
cron_expression TEXT NOT NULL,     -- e.g. "0 9 * * 1-5" (Mon-Fri 9am)
timezone TEXT NOT NULL DEFAULT 'UTC',
enabled INTEGER NOT NULL DEFAULT 1,
next_run_at INTEGER,               -- ms epoch, derived
last_run_at INTEGER,               -- ms epoch
last_run_session_id TEXT,          -- session tạo ra lần chạy gần nhất
created_at INTEGER NOT NULL,
updated_at INTEGER NOT NULL,
created_by TEXT                    -- user id (single-user nên optional)
```

Bảng `scheduled_job_runs` (lịch sử):
```sql
id TEXT PRIMARY KEY,
job_id TEXT NOT NULL,              -- FK → scheduled_jobs
scheduled_for INTEGER NOT NULL,
started_at INTEGER,
finished_at INTEGER,
status TEXT,                       -- 'pending' | 'running' | 'success' | 'failed' | 'skipped'
session_id TEXT,                   -- session được tạo
error TEXT
```

### 3.3. Thư viện
- `croner` (đã reference trong WBS) — cron expression parser, có sẵn timezone, không cần
  thêm DB-backed job queue.
- Cài: `pnpm add croner --filter @opencode/server` (hoặc package name tương ứng).

### 3.4. Runtime
- **M1: in-process scheduler (đơn giản, đủ dùng cho single-user).**
  - Trong `apps/server/src/server.ts` (hoặc module `scheduler.ts` mới), khi boot:
    1. Load tất cả job `enabled=1` từ DB.
    2. Với mỗi job, dùng `croner.Cron(pattern, { timezone, protect: true })` để schedule.
    3. Callback tạo 1 session qua `client.session.create()` rồi `client.session.chat()` với
       prompt. Theo dõi session status, update `last_run_at` + `runs` table.
  - Restart server → jobs tự động reload vào scheduler.
  - **Caveat**: nếu server down khi tới giờ → lần chạy bị miss. Có thể backfill bằng
    "catch-up" logic: khi restart, check `next_run_at < now`, nếu quá gần (≤ 5 phút) thì
    chạy luôn, nếu quá xa thì bỏ qua + log.
- **M2 (tương lai)**: tách thành microservice `apps/orchestrator/` (đã có sẵn Phase 4).

### 3.5. REST API
Mount vào `apps/server/src/routes/scheduled.ts`:
| Method | Path | Body / Query | Mô tả |
|--------|------|--------------|-------|
| `GET` | `/api/scheduled` | — | list jobs (filter theo workspaceId) |
| `POST` | `/api/scheduled` | `{ workspaceId, name, prompt, cron, timezone }` | tạo job |
| `GET` | `/api/scheduled/:id` | — | detail + last 20 runs |
| `PATCH` | `/api/scheduled/:id` | partial fields | update (validate cron lại) |
| `DELETE` | `/api/scheduled/:id` | — | xóa |
| `POST` | `/api/scheduled/:id/run` | — | chạy ngay lập tức (manual trigger) |
| `GET` | `/api/scheduled/:id/runs` | `?limit=` | lịch sử run |

Auth: dùng middleware có sẵn (`token`) — kiểm tra trong `apps/server/src/server.ts`.

### 3.6. UI
- **Page mới**: `apps/app/src/react-app/domains/settings/pages/scheduled-tasks-page.tsx`
  - Danh sách jobs (table): Name / Workspace / Cron / Next run / Last run / Status / actions.
  - Button "New scheduled task" → mở `CreateScheduledTaskDialog` (form: name, workspace
    picker, prompt textarea, cron expression input + helper "Every day at 9am" / "Every
    Monday", timezone select).
  - Toggle enable/disable (inline).
  - Row click → detail drawer với lịch sử runs (status, session link, error).
  - Edit dialog (same form, prefilled).
- **Routing**: thêm tab trong Settings (đã có pattern ở `shell-view.tsx`).
- **Hook vào sidebar Milestone 1**: item "Scheduled" navigate sang page này.
- **Empty state**: nếu chưa có job nào → hero + "Create your first scheduled task" button.
- **Error state**: cron invalid → toast + inline error dưới input.

### 3.7. Cron expression UX
- Input thô với placeholder `0 9 * * 1-5`.
- Helper chips bên dưới: "Every minute", "Every hour", "Every day at 9am", "Every Monday",
  "Weekdays 9am" — click để fill.
- Real-time "Next 3 runs" hiển thị ngay dưới input (dùng `croner` parse phía client).

### 3.8. Tasks (theo WBS, tinh chỉnh lại)
| # | Task | Effort | Reference / file | Output |
|---|------|--------|------------------|--------|
| 2.1 | DB migration `scheduled_jobs` + `scheduled_job_runs` | 2h | `apps/server/src/db/migrations/*` (theo pattern có sẵn) | 2 file migration |
| 2.2 | Repository + Zod schemas | 1h | mới: `apps/server/src/scheduled/repo.ts` | types + CRUD |
| 2.3 | Cron runner module (`scheduler.ts`) | 6h | WBS: `cronService.ts` (AionUi) | boot/teardown, croner wiring, catch-up |
| 2.4 | Execute engine (tạo session + chat) | 4h | mới: `apps/server/src/scheduled/runner.ts` | invoke opencode client, write `runs` |
| 2.5 | REST routes `/api/scheduled/*` | 4h | theo pattern `apps/server/src/routes/sessions.ts` | 7 endpoint + 5 test |
| 2.6 | Settings page `scheduled-tasks-page.tsx` | 6h | WBS: `ScheduledTasksPage/index.tsx` (AionUi) | list + dialog |
| 2.7 | Create/Edit dialog + cron helper + "next runs" preview | 4h | mới: `CreateScheduledTaskDialog.tsx` | form + chips + preview |
| 2.8 | Detail drawer + run history | 3h | mới: `ScheduledTaskDetailDrawer.tsx` | list runs + link to session |
| 2.9 | Wire sidebar "Scheduled" item → navigate to page | 0.5h | edit `session-route.tsx` (đã làm ở M1) | navigation |
| 2.10 | i18n (10 locale) | 1.5h | edit 10 file locale | 12-15 key mỗi file |
| 2.11 | E2E test (Daytona / Playwright) | 4h | theo `evals/` pattern | fraimz + run-once job |
| 2.12 | Docs: cập nhật `WBS.md` Phase 3 từ ❌ → ✅ (theo từng task) | 0.5h | edit `WBS.md` | done |

**Subtotal: ~36.5h (~5 ngày làm việc)**

Tổng cộng M1 + M2 = **~43h**, hơi vượt WBS estimate 38h một chút vì thêm phần
catch-up logic + cron UX polish.

### 3.9. Tiêu chí xong (Definition of Done)
- Tạo được 1 job, persist DB.
- Reload server → job tự động register lại.
- Job chạy đúng lịch (test với cron expression "every minute"), tạo session mới,
  ghi `runs` row status `success`.
- Enable/disable từ UI có hiệu lực ngay lập tức (cancel/re-register cron).
- Edit cron → "next 3 runs" update đúng.
- i18n đủ 10 locale.
- E2E test pass trên Daytona.
- `WBS.md` Phase 3 cập nhật trạng thái.

---

## 4. Quyết định đã lock (user confirm)

1. **Skills & Connect Mobile item** — wire tạm sang Settings, label "(soon)" khi backend chưa có.
2. **Scheduler runtime** — in-process trong `apps/server` (đơn giản, đủ dùng, đúng WBS Phase 3).
3. **Cron UX** — input thô + chips helper + "Next 3 runs" preview realtime.
4. **Quick-schedule từ composer** — có, thêm nút "Schedule this prompt" ở composer (M2, +2h).
5. **Multi-user / permissions** — single-user v1, bỏ qua cột `created_by` cho tới khi cần.

> Owner hiện tại: 1 người, làm solo. Plan review/repo chores sẽ tối giản — không cần multi-PR
> dance, có thể gộp M2 vào 1-2 PR lớn.

### 4.1. M2 quyết định bổ sung (locked 2026-07-12, M2 prep review)

Sau khi self-review M1 + check codebase thật, mình pin thêm 4 quyết định cho M2:

6. **Default timezone = Asia/Tokyo (UTC+9)** — lưu per-job, có thể đổi khi edit. Khớp
   với user location hiện tại. UI timezone select vẫn đầy đủ (UTC, America/..., …).
7. **Catch-up window = 5 phút** — server restart trong lúc job đáng lẽ chạy:
   - `now - next_run_at ≤ 5 phút` → chạy luôn 1 lần (run-once).
   - `> 5 phút` → skip, ghi `runs` row với status `skipped`, log.
   Có thể config per-job sau (nâng cấp sau).
8. **M2 scope = full** — không split M2a/M2b. 1 lần ship full backend + UI page + dialog
   + drawer + cron UX + i18n 10 locale + E2E. Effort ~36.5h.
9. **Runner concurrency = skip-overlap** — nếu job cũ còn `running` khi tới giờ chạy
   tiếp theo → skip run mới, ghi `runs` status `skipped_overlap`. An toàn cho v1 single-user,
   tránh OpenCode SDK bị overwhelm khi 1 job prompt lặp lại liên tục.

### 4.2. Plan §3 corrections (M2 prep findings, 2026-07-12)

Sau khi re-read codebase thật, mình điều chỉnh plan §3 như sau (giữ nguyên scope,
chỉ thay đổi implementation approach để khớp convention hiện có):

| Plan §3 viết | Codebase thật | Approach mới |
|---|---|---|
| "DB migration file `apps/server/src/db/migrations/<ts>-scheduled-jobs.sql`" | Không có `db/` dir, không có migration file convention. `file-snapshots.ts:183` dùng `CREATE TABLE IF NOT EXISTS` on init trong cùng `runtime.sqlite`. | Follow pattern `file-snapshots.ts` — Drizzle schema trong module + hand-written `CREATE TABLE IF NOT EXISTS` trong hàm `init()`. Drizzle chỉ cho type-safe query. |
| "REST routes + Zod schemas" | Routes KHÔNG dùng Zod (`routes/sessions.ts`), dùng manual parser qua `parseOptional*` helpers. | Skip Zod, dùng parser thủ công giống `routes/sessions.ts`. |
| "Cron runner: `client.session.chat()`" (§3.4) | SDK là `client.session.prompt()` (line 172 sdk.gen.d.ts) | Đổi tên method: `client.session.prompt({ path: { id }, body: { parts: [{ type: "text", text: prompt }] } })`. |
| "Thêm tab trong Settings (đã có pattern ở `shell-view.tsx`)" | Pattern thật: thêm case `"scheduled"` vào `SettingsTab` union + `getSettingsTabIcon` + `getSettingsTabLabel` + sidebar item trong `settings-page.tsx`. | Tạo `scheduled-view.tsx` page, thêm 4 chỗ trong `settings-page.tsx`. |
| "EVK file `prds/terminal-b/`" | (M1 có) | Tạo mới: `apps/app/src/react-app/domains/settings/scheduled/` (folder riêng cho clarity, theo pattern `session/`). |

> Plan §3.8 task list & effort giữ nguyên — chỉ thay implementation, không tăng LOC.

---

## 5. Risks & giảm thiểu

| Risk | Mitigation |
|------|-----------|
| Server restart miss run | catch-up logic khi boot (xem 3.4) |
| Cron sai múi giờ | timezone lưu riêng, default Asia/Tokyo cho user, validate bằng `croner` |
| Prompt chạy lâu chiếm slot | runner có timeout 10 phút / job, status `failed` nếu quá |
| N+1 jobs → spam | rate-limit mỗi workspace: max 20 active jobs |
| UI render nặng khi list lớn | virtualize table nếu > 50 row (chưa cần ngay) |
| Plugin "Scheduler" tương lai đè lên | giữ cùng interface `SchedulerPlugin` (forward-compat) |

---

## 6. Out of scope (để phase sau)
- Webhook trigger / event-based scheduling (chỉ time-based).
- Retry policy tuỳ biến.
- Conditional cron ("chỉ chạy nếu file X tồn tại").
- Calendar UI thay vì cron expression.
- Multi-tenant isolation.

---

## 7. File sẽ tạo / sửa (quick index)

**Mới (M1):**
- `apps/app/src/react-app/domains/session/sidebar/quick-actions-group.tsx`
- `apps/app/src/react-app/domains/session/sidebar/quick-actions-group.test.tsx`

**Sửa (M1):**
- `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx`
- `apps/app/src/react-app/domains/session/sidebar/app-sidebar-provider.tsx`
- `apps/app/src/react-app/shell/session-route.tsx`
- `apps/app/src/i18n/locales/{en,vi,ja,zh,th,ru,pt-BR,fr,es,ca}.ts`

**Mới (M2):**
- `apps/server/src/db/migrations/<ts>-scheduled-jobs.sql`
- `apps/server/src/scheduled/repo.ts`
- `apps/server/src/scheduled/scheduler.ts`
- `apps/server/src/scheduled/runner.ts`
- `apps/server/src/routes/scheduled.ts`
- `apps/server/src/scheduled/repo.test.ts`
- `apps/server/src/routes/scheduled.test.ts`
- `apps/app/src/react-app/domains/settings/pages/scheduled-tasks-page.tsx`
- `apps/app/src/react-app/domains/settings/dialogs/create-scheduled-task-dialog.tsx`
- `apps/app/src/react-app/domains/settings/drawers/scheduled-task-detail-drawer.tsx`
- `apps/app/src/react-app/domains/settings/scheduled/hooks.ts`
- `apps/app/src/react-app/domains/settings/scheduled/cron-helpers.ts`
- `evals/scheduled-task-flow.eval.ts`

**Sửa (M2):**
- `apps/server/src/server.ts` (mount route + boot scheduler)
- `apps/server/package.json` (thêm `croner`)
- `apps/app/src/react-app/domains/settings/pages/shell-view.tsx` (thêm tab)
- 10 file i18n

---

## 8. Timeline đề xuất

| Ngày | Việc |
|------|------|
| Day 1 | M1 toàn bộ (1-2 PR nhỏ) |
| Day 2-3 | M2 backend: DB + repo + scheduler + runner + routes + tests |
| Day 4-5 | M2 UI: page + dialog + drawer + i18n |
| Day 6 | E2E test (Daytona), fix bug, polish |
| Day 7 | Buffer, docs, demo |

Nếu bạn confirm approach ở §4, mình có thể bắt tay M1 luôn hôm nay.
