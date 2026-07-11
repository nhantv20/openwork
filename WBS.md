# WBS — OpenWork Port từ AionUi

> **Cập nhật:** 2026-07-12  
> **Mục tiêu:** Fork OpenWork (different-ai/openwork, dev) tích hợp các tính năng từ AionUi  
> **Owner:** Nhân

---

## Ký hiệu

| Ký hiệu | Ý nghĩa |
|---------|---------|
| ✅ **DONE** | Đã hoàn thành, đã verify |
| 🔶 **PARTIAL** | Có building blocks, thiếu 1-2 phần |
| ⚠️ **EARLY** | Mới có nền tảng, cần xây nhiều |
| ❌ **NONE** | Chưa có gì |
| 📌 **TODO** | Kế hoạch làm tiếp theo |

> **Cách đọc Reference Files:**  
> `📄 path/to/file` = file đã có trong OpenWork (cần đọc để hiểu code)  
> `🔗 aionui:path/to/file` = file tham chiếu trong AionUi (cần đọc để port)  
> `📄 → 🔗` = so sánh giữa OpenWork và AionUi để biết thiếu gì

---

## Phase 1: File Preview ✅ DONE (90%)

> **Mục tiêu:** Preview PDF / DOCX / XLSX / PPT / ảnh / code 80+ ngôn ngữ / diff  
> **Key entry points để đọc:** `preview.tsx` → `artifact-panel.tsx` → `open-target.ts` → `viewers/`

### Đã làm

| Task | Reference Files | Chi tiết |
|------|----------------|----------|
| ✅ PreviewPanel | 📄 `apps/app/src/react-app/domains/session/artifacts/preview.tsx` | Core preview container, switch render theo type |
| ✅ ArtifactPanel (multi-tab) | 📄 `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` | Tabs, save, edit, download, open-external, show-in-folder |
| ✅ Preview + FileTree | 📄 `apps/app/src/react-app/domains/session/artifacts/preview-with-file-tree.tsx` | Side-by-side layout |
| ✅ SlidesPreview (PPT) | 📄 `apps/app/src/react-app/domains/session/artifacts/viewers/slides-viewer.tsx` | OfficeCLI qua Electron IPC |
| ✅ DocumentPreview (DOCX) | 📄 `apps/app/src/react-app/domains/session/artifacts/viewers/document-viewer.tsx` | Mammoth → HTML |
| ✅ SpreadsheetPreview (XLSX) | 📄 `apps/app/src/react-app/domains/session/artifacts/viewers/spreadsheet-viewer.tsx` | SheetJS/xlsx |
| ✅ DiffViewer | 📄 `apps/app/src/react-app/domains/session/artifacts/viewers/diff-viewer.tsx` | Side-by-side unified diff |
| ✅ CodePreview | 📄 `apps/app/src/lib/shiki.ts` (Shiki 4.0) | Syntax highlight 80+ langs |
| ✅ MarkdownPreview | 📄 `apps/app/src/react-app/domains/session/artifacts/markdown-live-preview.ts` | ReactMarkdown + remark-gfm |
| ✅ PDF / Image / Video / Audio | 📄 `apps/app/src/react-app/domains/session/artifacts/preview.tsx` (dòng ~200-250) | Native elements |
| ✅ TextEditor | 📄 `apps/app/src/react-app/domains/session/artifacts/artifact-text-editor.tsx` | CodeMirror 6 |
| ✅ SpreadsheetEditor | 📄 `apps/app/src/react-app/domains/session/artifacts/artifact-spreadsheet-editor.tsx` + `.ts` | SheetJS-based |
| ✅ File classification | 📄 `apps/app/src/react-app/domains/session/artifacts/open-target.ts` | classifyOpenTarget() map 80+ ext |
| ✅ Icon mapping | 📄 `apps/app/src/react-app/domains/session/artifacts/artifact-icon.tsx` | File type → lucide icon |
| ✅ Preview limits | 📄 `apps/app/src/react-app/domains/session/artifacts/preview-limits.ts` | 5MB text limit |

### Còn lại (📌 Priority 4)

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| Multi-tab drag reorder | ~4h | 🔗 `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewTabs.tsx` | Kéo thả tab artifact |

---

## Phase 2: Skills / Built-in Assistants ✅ DONE (85%)

> **Mục tiêu:** 21 assistants dạng skill files  
> **Key entry points để đọc:** `.opencode/skills/` → `settings/pages/skills-view.tsx` → `apps/server/src/skill-hub.ts`

### Đã làm

| Task | Reference Files | Chi tiết |
|------|----------------|----------|
| ✅ Skills system | 📄 `.opencode/skills/` (40 skills) | Mỗi skill là 1 folder với SKILL.md |
| ✅ Skills management UI | 📄 `apps/app/src/react-app/domains/settings/pages/skills-view.tsx` | Install, delete, share to org, search, cloud sync |
| ✅ Plugins system | 📄 `apps/app/src/react-app/domains/settings/pages/plugins-view.tsx` | Plugin registry + CRUD |
| ✅ Extension registry | 📄 `apps/app/src/lib/extension-config.ts` | Skills/plugins/MCPs |
| ✅ Cloud skill sharing | 📄 `apps/server/src/skill-hub.ts` | Upload skills to org |
| ✅ Claude plugin bundle | 📄 `apps/app/src/lib/claude-plugin-bundle.ts` | Import Claude plugins → OpenWork skills |
| ✅ AionUi assistant types (tham khảo) | 🔗 `aionui:packages/desktop/src/common/types/agent/assistantTypes.ts` | Schema assistant trong AionUi |

### Còn lại (📌 Priority 3)

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| Skill image-gen | ~4h | 🔗 `aionui:packages/desktop/src/common/chat/imageGenCore.ts` + 📄 `settings/openai-image-gen-config.tsx` | Đã có extension, thiếu SKILL.md |
| Skill citation-extractor | ~8h | 📄 `.opencode/skills/research-assistant/` (nếu có) | Workflow research |
| Skill note-synthesizer | ~8h | 📄 `.opencode/skills/planning-with-files/` (pattern tham khảo) | Gộp nhiều ghi chú |

---

## Phase 3: Scheduled Tasks (Cron) ❌ NONE (TODO Priority 1)

> **Mục tiêu:** Cron task 24/7, agent chạy định kỳ  
> **Reference AionUi để port:** 🔗 `aionui:packages/desktop/src/renderer/pages/cron/`

### Phải làm

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| 📌 DB migration: cron_jobs | ~2h | 🔗 `aionui:packages/desktop/src/renderer/pages/cron/cronUtils.ts` | Schema: id, user_id, cron_expr, prompt, enabled... |
| 📌 Cron runner service | ~8h | 🔗 `aionui:packages/desktop/src/process/utils/cronService.ts` + 📄 `apps/server/package.json` (thêm croner) | Bun server cron |
| 📌 CRUD API routes | ~4h | 🔗 `aionui:packages/desktop/src/renderer/pages/cron/useCronJobs.ts` + 📄 `apps/server/src/routes/sessions.ts` (pattern) | `GET/POST/PUT/DELETE /api/cron` |
| 📌 Settings UI page | ~12h | 🔗 `aionui:packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx` + `CreateTaskDialog.tsx` | Create/edit/enable/disable |
| 📌 Execution engine | ~8h | 🔗 `aionui:packages/desktop/src/renderer/pages/cron/components/CronJobManager.tsx` | Gửi prompt vào conversation đúng lịch |
| 📌 E2E test | ~4h | — | Verify cron chạy đúng giờ |

**Tổng effort: ~38h (~1 tuần)**

---

## Phase 4: Remote Access / Channels ⚠️ EARLY (15%)

> **Mục tiêu:** Telegram, WebUI, WhatsApp, Slack điều khiển agent từ xa  
> **Key entry points để đọc:** `settings/pages/messaging-view.tsx` → `apps/orchestrator/src/`

### Đã làm

| Task | Reference Files | Chi tiết |
|------|----------------|----------|
| ✅ Telegram integration | 📄 `apps/app/src/react-app/domains/settings/pages/messaging-view.tsx` | Bot token, pairing code, identities |
| ✅ OpenCode Router | 📄 `apps/orchestrator/src/` | Message relay → Telegram |

### Phải làm

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| 📌 WebUI server (Bun) | ~16h | 🔗 `aionui:packages/web-host/src/index.ts` + `scripts/webui.ts` | QR code, mobile access |
| 📌 WhatsApp channel | ~12h | 🔗 `aionui:examples/ext-feishu/channels/ext-feishu-channel.js` (pattern) | whatsapp-web.js |
| 📌 Slack channel | ~8h | 🔗 (pattern tương tự) | Bolt SDK |
| 📌 Channel management UI | ~8h | 📄 `messaging-view.tsx` (mở rộng) | Settings multi-channel |

**Tổng effort: ~44h (~1 tuần)** — **không ưu tiên ngay**

---

## Phase 5: File Tree ✅ DONE (85%)

> **Mục tiêu:** Browse workspace, auto-organize, batch rename  
> **Key entry points để đọc:** `panel/file-explorer-panel.tsx` → `apps/server/src/routes/files.ts`

### Đã làm

| Task | Reference Files | Chi tiết |
|------|----------------|----------|
| ✅ FileExplorerPanel | 📄 `apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx` | Virtual tree (@tanstack/react-virtual), lazy load |
| ✅ Server routes | 📄 `apps/server/src/routes/files.ts` | dir, stat, content (read/write), raw, mkdir, delete, rename, batch |
| ✅ File sessions | 📄 `apps/server/src/services/file-sessions.ts` | Revision tracking, conflict detection |
| ✅ Audit trail | 📄 `apps/server/src/services/audit.ts` | File operation logging |
| ✅ Side-by-side preview | 📄 `apps/app/src/react-app/domains/session/artifacts/preview-with-file-tree.tsx` | File tree + artifact panel |
| ✅ Inbox/Outbox | 📄 `apps/server/src/routes/files.ts` (inbox/outbox sections) | Artifact transfer |

### Còn lại (📌 Priority 4)

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| Context menu (rename/delete/move) | ~4h | 🔗 `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/components/WorkspaceContextMenu.tsx` | Click chuột phải |
| Batch operations UI | ~4h | — | Select nhiều file → xoá/di chuyển hàng loạt |

---

## Phase 6: Version History ⚠️ EARLY (5%) — 📌 PRIORITY CAO NHẤT

> **Mục tiêu:** Track file changes, rollback 1-click  
> **Key entry points để đọc:** `file-sessions.ts` → `audit.ts` → `viewers/diff-viewer.tsx`  
> **Reference AionUi để port:** 🔗 `aionui:packages/desktop/src/renderer/pages/conversation/Preview/hooks/usePreviewHistory.ts`

### Đã làm (building blocks)

| Task | Reference Files | Chi tiết |
|------|----------------|----------|
| ✅ Revision tracking | 📄 `apps/server/src/services/file-sessions.ts` | Dùng `mtimeMs:size` làm revision ID |
| ✅ Conflict detection | 📄 `apps/server/src/services/file-sessions.ts` | `ifMatchRevision` trong write ops |
| ✅ DiffViewer component | 📄 `apps/app/src/react-app/domains/session/artifacts/viewers/diff-viewer.tsx` | Side-by-side split diff |
| ✅ Audit trail | 📄 `apps/server/src/services/audit.ts` | Ghi log file operations |

### Phải làm

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| 📌 DB migration: file_snapshots | ~2h | 🔗 `aionui:packages/desktop/src/renderer/pages/conversation/Preview/hooks/usePreviewHistory.ts` (schema pattern) | Schema: id, workspace_id, file_path, content_hash, content, created_at, trigger |
| 📌 Auto-snapshot middleware | ~4h | 🔗 `aionui:packages/desktop/src/process/utils/snapshotService.ts` (ước lượng) | Snapshot content trước khi ghi đè file |
| 📌 History API route | ~4h | 📄 `apps/server/src/routes/files.ts` (pattern) | `GET /workspace/:id/files/:path/history` + `POST .../restore` |
| 📌 History UI dropdown | ~8h | 🔗 `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewHistoryDropdown.tsx` | Danh sách version + restore button |
| 📌 Diff compare 2 versions | ~4h | 📄 `viewers/diff-viewer.tsx` (đã có) + API mới | So sánh bất kỳ 2 snapshot |

**Tổng effort: ~26h (~3 ngày)**

---

## Phase 7: Multi-tab Sessions 🔶 PARTIAL (40%)

> **Mục tiêu:** Mở nhiều conversation song song, tab strip, drag-drop  
> **Key entry points để đọc:** `app-sidebar.tsx` → `panel-tab-store.ts` → `side-panel.tsx`

### Đã làm

| Task | Reference Files | Chi tiết |
|------|----------------|----------|
| ✅ Session sidebar | 📄 `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx` | List, search, pin, archive, groups, drag-drop (motion/react) |
| ✅ Session groups store | 📄 `apps/app/src/lib/stores/session-management-store.ts` | Group CRUD, assign sessions |
| ✅ Side-panel tabs | 📄 `apps/app/src/lib/stores/panel-tab-store.ts` + 📄 `side-panel.tsx` | Artifact + browser tabs |
| ✅ Session groups API | 📄 `apps/server/src/routes/sessions.ts` (session-groups sections) | Server-side SQLite |

### Còn lại (📌 Priority 3)

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| 📌 In-conversation tab strip | ~8h | 🔗 `aionui:packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx` + `ConversationRow.tsx` | Tab ngang chuyển conversation nhanh |
| 📌 Drag-drop tab reorder | ~4h | 📄 `app-sidebar.tsx` (đã dùng motion/react Reorder, pattern có sẵn) | Kéo thả tab |

---

## Phase 8: Multi-Agent Team Mode ❌ NONE

> **Mục tiêu:** Phối hợp nhiều agent, leader + teammates  
> **Reference AionUi để port:** 🔗 `aionui:packages/desktop/src/renderer/pages/team/`

### Phải làm (nếu cần)

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| ❌ DB: teams, team_members, mailbox | ~4h | 🔗 `aionui:packages/desktop/src/common/types/team/teamTypes.ts` | Schema |
| ❌ ACP SDK integration | ~16h | 🔗 `aionui:packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx` | `@agentclientprotocol/sdk` |
| ❌ Team UI page | ~24h | 🔗 `aionui:packages/desktop/src/renderer/pages/team/TeamPage.tsx` + `TeamChatView.tsx` | Team chat, member cards |
| ❌ Leader delegation | ~16h | 🔗 `aionui:packages/desktop/src/renderer/pages/team/hooks/useTeamSession.ts` | Phân tích task, delegate, tổng hợp |

**Tổng effort: ~60h (>1 tuần)** — **không ưu tiên**

---

## Phase 9: MCP Management ✅ DONE (90%)

> **Mục tiêu:** Config MCP 1 lần, dùng cho mọi agent  
> **Key entry points để đọc:** `settings/pages/mcp-view.tsx` → `connections/modals/`

### Đã làm

| Task | Reference Files | Chi tiết |
|------|----------------|----------|
| ✅ MCP Settings view | 📄 `apps/app/src/react-app/domains/settings/pages/mcp-view.tsx` | List, enable/disable, auth flows, status indicators |
| ✅ Add MCP Modal | 📄 `apps/app/src/react-app/domains/connections/modals/add-mcp-modal.tsx` | Thêm MCP server |
| ✅ MCP Auth | 📄 `apps/app/src/react-app/domains/connections/mcp-auth-modal.tsx` | OAuth flow |
| ✅ Silent Reauth | 📄 `apps/app/src/react-app/domains/connections/mcp-silent-reauth.ts` | Tự động reauth |
| ✅ Claude Plugin Import | 📄 `apps/app/src/react-app/domains/connections/modals/claude-plugin-import-modal.tsx` | Import từ Claude |
| ✅ Server MCP config | 📄 `apps/server/src/mcp.ts` | List, validate |
| ✅ Cloud plugins | 📄 `apps/app/src/lib/cloud-plugins.ts` | MCP từ cloud plugin manifests |
| ✅ Extension config registry | 📄 `apps/app/src/lib/extension-config.ts` | MCP settings panels |
| ✅ E2E tests | 📄 `apps/app/e2e/mcp/mcp.oauth-flow.e2e.test.ts` + `.engine-sync.e2e.test.ts` + `.remote-connect.e2e.test.ts` | 3 test files |

---

## Phase 10: Custom CSS Theming ❌ NONE (TODO Priority 3)

> **Mục tiêu:** User custom giao diện qua CSS  
> **Reference AionUi để port:** 🔗 `aionui:packages/desktop/src/renderer/pages/settings/AppearanceSettings/CssThemeSettings.tsx`

### Phải làm

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| 📌 CSS injector | ~2h | 🔗 `aionui:packages/desktop/src/renderer/components/settings/AppearanceSettings/useCustomCSS.ts` | Inject/eject `<style id="custom-theme-css">` |
| 📌 Settings UI | ~4h | 🔗 `aionui:packages/desktop/src/renderer/pages/settings/AppearanceSettings/CssThemeSettings.tsx` + `CssThemeModal.tsx` | CSS editor + live preview |
| 📌 Preset themes | ~2h | 🔗 `aionui:packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets/` | 1-2 theme mẫu |
| 📌 Persist to localStorage | ~2h | 📄 `apps/app/src/lib/stores/` (pattern zustand persist) | Lưu CSS giữa sessions |

**Tổng effort: ~10h (~2 ngày)**

---

## Phase 11: Image Generation ⚠️ EARLY (25%) — 📌 PRIORITY 2

> **Mục tiêu:** Tạo ảnh từ prompt ngay trong app  
> **Key entry points để đọc:** `settings/openai-image-gen-config.tsx` → extension registry  
> **Reference AionUi để port:** 🔗 `aionui:packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts`

### Đã làm

| Task | Reference Files | Chi tiết |
|------|----------------|----------|
| ✅ Extension config + settings UI | 📄 `apps/app/src/react-app/domains/settings/openai-image-gen-config.tsx` | Settings panel cho OpenAI image |
| ✅ Extension registration | 📄 `apps/app/src/lib/extensions/openai-image-extension.ts` | `image_generate` action |
| ✅ Client constants | 📄 `apps/app/src/lib/extensions/openai-image-extension.ts` (OPENAI_IMAGE_EXTENSION_ID) | ID extension |

### Phải làm

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| 📌 Skill image-gen SKILL.md | ~4h | 🔗 `aionui:packages/desktop/src/common/chat/imageGenCore.ts` + 📄 `.opencode/skills/ppt-creator/SKILL.md` (pattern) | `.opencode/skills/image-gen/SKILL.md` |
| 📌 In-chat image render | ~2h | 📄 `viewers/image-viewer.tsx` (đã có) | Hiển thị ảnh trong message |
| 📌 Built-in MCP server (optional) | ~8h | 🔗 `aionui:packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts` + `imageGenerationMcpEnv.ts` | MCP server như AionUi |

**Tổng effort: ~6-14h (~1-2 ngày)**

---

## Phase 12: Right Panel UX (MiniMax-style) ✅ DONE (60%)

> **Mục tiêu:** Hợp nhất 2 panel phải (file explorer + side panel) thành 1 panel duy nhất với 3 nút toggle exclusive (Files / Preview / Browser) + nút `×` đóng. Tham khảo MiniMax Code.
> **Key entry points để đọc:** `docs/ux-spec-side-panel-minimax-style.md` → `right-panel.tsx` → `file-explorer-panel.tsx` → `panel-tab-store.ts` → `file-explorer-store.ts`
> **Cập nhật:** 2026-07-12

### Đã làm

| Task | Reference Files | Commit | Chi tiết |
|------|----------------|--------|----------|
| ✅ UX Spec đầy đủ (13 bước) | 📄 `docs/ux-spec-side-panel-minimax-style.md` | — | Spec tham khảo MiniMax Code, state machine, persistence plan |
| ✅ <RightPanel /> component mới | 📄 `apps/app/src/react-app/domains/session/panel/right-panel.tsx` | `44e68843` | Header 3-button toggle (Files/Preview/Browser) + `⋯` cho Voice/Extensions + `×` close |
| ✅ Refactor <SessionPage /> mount 1 panel | 📄 `apps/app/src/react-app/domains/session/chat/session-page.tsx` | `44e68843` | Bỏ switch giữa `<FileExplorerPanel />` và `<SidePanel />` |
| ✅ Nút Reload artifact | 📄 `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` | `44e68843` | RefreshCw button + invalidate query |
| ✅ Auto-reload polling 3s | 📄 `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` | `44e68843` | Polling `statWorkspaceFile`, pause khi tab ẩn |
| ✅ File tree search | 📄 `apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx` | `44e68843` | Diacritic-insensitive, multi-word AND, auto-expand kết quả |
| ✅ "Open in editor" context menu | 📄 `apps/app/src/app/lib/desktop.ts` + 📄 `apps/desktop/electron/main.mjs` | `44e68843` | VS Code, Cursor, Sublime, WebStorm, IDEA, nvim, vim |
| ✅ @ mention list files on open | 📄 `apps/app/src/react-app/shell/session-route.tsx` | `44e68843` | `listFiles` provider cho `@`-mention popup |
| ✅ Global opencode config provider merge | 📄 `apps/server/src/openwork-runtime-config.ts` | `44e68843` | Đọc `~/.config/opencode/opencode.json[c]` |
| ✅ File-explorer-store (persisted) | 📄 `apps/app/src/react-app/domains/session/panel/file-explorer-store.ts` | `c8da316e` | Zustand + persist localStorage, key theo workspace |
| ✅ Persist artifact tabs | 📄 `apps/app/src/react-app/domains/session/panel/panel-tab-store.ts` | `c8da316e` | Bump key v1→v2, restore tabs khi mở lại session |
| ✅ Auto-expand ancestor khi mở file | 📄 `file-explorer-store.ts` + `file-explorer-panel.tsx` | `cb521f5c` | `expandAncestors(workspaceId, filePath)` |
| ✅ Sync tree selection với active tab | 📄 `file-explorer-panel.tsx` | `cb521f5c` | Watch `useSessionActiveTabId` → highlight + expand |
| ✅ Fix infinite render loop | 📄 `file-explorer-store.ts` | `ff32f2ac` | Hook return array thay vì Set mới mỗi render |
| ✅ Fix tree descendants bị wipe | 📄 `file-explorer-panel.tsx` | `ef67d5a0` | Bỏ effect rebuild tree khi `expandedPaths` đổi |
| ✅ Fix empty state cho returning workspace | 📄 `file-explorer-panel.tsx` | `666eb639` | Luôn setTree khi data load, dù có persisted state |

### Còn lại (theo spec)

| Task | Effort | Reference để phát triển | Mô tả |
|------|--------|------------------------|-------|
| 📌 Keyboard shortcuts (Cmd+Shift+F/P/B, Esc đóng, Cmd+. đóng) | ~45' | Spec §7 + 📄 `apps/app/src/react-app/shell/use-shell-shortcuts.ts` | Mở nhanh 3 mode + đóng panel |
| 📌 Empty states polish (3 mode) | ~30' | Spec §8 | Empty state rõ ràng cho files/preview/browser |
| 📌 Optimize polling (1 interval per session) | ~1-1.5h | Spec §10 | Gộp polling thay vì mỗi ArtifactPanel 1 interval |
| 📌 Drag file từ tree vào chat | ~2-2.5h | Spec §12 | `@file/path` mention khi kéo thả |
| 📌 File tree search highlight match | ~30' | `file-explorer-panel.tsx` | Highlight phần match trong tên file |
| 📌 In-conversation tab strip | ~8h | 🔗 AionUi GroupedHistory | Tab ngang chuyển conversation nhanh (Phase 7) |

---

## Tổng quan tiến độ

| Phase | Feature | Status | Effort còn lại | Mức ưu tiên |
|-------|---------|--------|----------------|-------------|
| 1 | File Preview | ✅ 90% | ~4h | — |
| 2 | Skills / Assistants | ✅ 85% | ~20h | 🟢 Trung bình |
| **3** | **Scheduled Tasks** | **❌ 0%** | **~38h** | **🔴 Cao** |
| 4 | Remote Access | ⚠️ 15% | ~44h | ⚪ Thấp |
| 5 | File Tree | ✅ 85% | ~8h | — |
| **6** | **Version History** | **⚠️ 5%** | **~26h** | **🔴 CAO NHẤT** |
| 7 | Multi-tab Sessions | 🔶 40% | ~12h | 🟢 Trung bình |
| 8 | Multi-Agent Team | ❌ 0% | ~60h | ⚪ Thấp |
| 9 | MCP Management | ✅ 90% | — | — |
| 10 | Custom CSS Theming | ❌ 0% | ~10h | 🟢 Trung bình |
| **11** | **Image Generation** | **⚠️ 25%** | **~6-14h** | **🔴 Cao** |
| **12** | **Right Panel UX** | **✅ 60%** | **~5h** | **🟢 Polish** |

---

## Priority Roadmap

```
TUẦN NÀY (Priority 1):
  ┌─ Phase 6: Version History ──────────────────────────────────┐
  │  📄 file-sessions.ts → 📄 audit.ts → 📄 diff-viewer.tsx     │  ~26h
  │  🔗 usePreviewHistory.ts (AionUi) → port snapshot + UI      │
  └─────────────────────────────────────────────────────────────┘

TUẦN SAU (Priority 2):
  ┌─ Phase 11: Image Generation ────────────────────────────────┐
  │  📄 openai-image-gen-config.tsx + 📄 extension registry      │  ~6-14h
  │  🔗 imageGenCore.ts (AionUi) → tao SKILL.md                 │
  └─────────────────────────────────────────────────────────────┘
  ┌─ Phase 3: Scheduled Tasks ──────────────────────────────────┐
  │  🔗 cronUtils.ts + useCronJobs.ts (AionUi)                  │  ~38h
  │  → DB migration → croner → API → UI                         │
  └─────────────────────────────────────────────────────────────┘

THÁNG NÀY (Priority 3):
  ┌─ Phase 10: Custom CSS ──────────────────────────────────────┐
  │  🔗 CssThemeSettings.tsx (AionUi) → injector → UI → presets  │  ~10h
  └─────────────────────────────────────────────────────────────┘
  ┌─ Phase 7: Multi-tab Sessions ───────────────────────────────┐
  │  📄 app-sidebar.tsx (pattern có sẵn)                        │  ~12h
  │  🔗 ConversationRow.tsx (AionUi) → tab strip                │
  └─────────────────────────────────────────────────────────────┘

SAU (Priority 4):
  • Phase 1: tab drag reorder      🔗 PreviewTabs.tsx
  • Phase 2: skill image-gen, citation-extractor
  • Phase 5: context menu, batch ops  🔗 WorkspaceContextMenu.tsx
  • Phase 4: WebUI, WhatsApp, Slack  🔗 webui.ts + ext-feishu
  • Phase 8: Multi-Agent Team        🔗 team/ (AionUi)
```

---

## File log

| File | Mô tả |
|------|-------|
| `aionui-to-openwork-port-guide.md` | Port guide gốc — 11 giai đoạn, code mẫu, dependencies |
| `WBS.md` | File này — WBS cập nhật theo hiện trạng + file references |
| `wbs-tasks-vi.xlsx` | WBS Excel (đồng bộ) |
