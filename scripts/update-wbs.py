#!/usr/bin/env python3
"""Cập nhật wbs-tasks-vi.xlsx với trạng thái thực tế + File Reference."""

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

WB_PATH = "/Users/trannhan/project/openwork/wbs-tasks-vi.xlsx"
wb = openpyxl.load_workbook(WB_PATH)

# === COLOR DEFS ===
DONE_FILL = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
DONE_FONT = Font(color="006100")
PROGRESS_FILL = PatternFill(start_color="FFEB9C", end_color="FFEB9C", fill_type="solid")
PROGRESS_FONT = Font(color="9A6B00")
NONE_FILL = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
NONE_FONT = Font(color="9C0006")
EARLY_FILL = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid")
EARLY_FONT = Font(color="974706")
PARTIAL_FILL = PatternFill(start_color="D9E2F3", end_color="D9E2F3", fill_type="solid")
PARTIAL_FONT = Font(color="1F3864")
HEADER_FILL = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
HEADER_FONT = Font(color="FFFFFF", bold=True, size=11)

# Phase colors
PHASE_COLORS = {
    "2": PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid"),  # done - green
    "3": PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid"),
    "4": PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid"),  # todo - orange
    "5": PatternFill(start_color="D9E2F3", end_color="D9E2F3", fill_type="solid"),  # early - blue
    "6": PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid"),
    "7": PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid"),
    "8": PatternFill(start_color="D9E2F3", end_color="D9E2F3", fill_type="solid"),
    "9": PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid"),  # hold - gray
    "10": PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid"),
    "11": PatternFill(start_color="D9E2F3", end_color="D9E2F3", fill_type="solid"),
    "12": PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid"),
    "13": PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid"),  # right panel ux - green
}

THIN_BORDER = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin')
)

def style_header(ws, row, cols):
    for col in range(1, cols + 1):
        cell = ws.cell(row=row, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = THIN_BORDER

def apply_status_style(cell, status):
    if status in ("完了", "DONE", "Hoàn thành"):
        cell.fill = DONE_FILL; cell.font = DONE_FONT
    elif status in ("進行中", "IN PROGRESS", "Đang làm"):
        cell.fill = PROGRESS_FILL; cell.font = PROGRESS_FONT
    elif status in ("保留", "HOLD", "Tạm hoãn"):
        cell.fill = EARLY_FILL; cell.font = EARLY_FONT
    elif status in ("未着手", "TODO", "Chưa bắt đầu"):
        cell.fill = NONE_FILL; cell.font = NONE_FONT
    elif "EARLY" in str(status) or "Sớm" in str(status):
        cell.fill = EARLY_FILL; cell.font = EARLY_FONT
    elif "PARTIAL" in str(status) or "Một phần" in str(status):
        cell.fill = PARTIAL_FILL; cell.font = PARTIAL_FONT

# ====================================================================
# DATA — mỗi dòng: [WBS, Name, Status, Priority, Owner, Start, Deadline, Done, Effort(h), %, Deps, Tags, Notes, Reference Files]
# ====================================================================
HEADERS = ["WBS", "Tên công việc", "Trạng thái", "Ưu tiên", "Người phụ trách",
           "Bắt đầu", "Deadline", "Ngày HT", "Effort (h)", "% HT", "Phụ thuộc", "Tags", "Ghi chú", "Reference Files"]

DATA = [
    # === PROJECT ===
    ["1.0", "Dự án OpenWork fork tích hợp AionUi", "進行中", "高", "Nhân",
     "2026-07-11", "2026-09-30", "", 613, 0, "", "", "Phase 1-12", ""],

    # === PHASE 1: FILE PREVIEW ===
    ["2.0", "Phase 1: File Preview ✅ DONE (90%)", "完了", "高", "Nhân",
     "", "", "2026-07-11", 120, 90, "", "preview", "Hầu hết đã có sẵn trong OpenWork",
     "📄 apps/app/src/react-app/domains/session/artifacts/preview.tsx (entry point)"],
    ["2.1", "PreviewPanel + ArtifactPanel (multi-tab)", "完了", "高", "Nhân",
     "", "", "2026-07-11", 16, 100, "", "preview,core", "preview.tsx + artifact-panel.tsx",
     "📄 preview.tsx\n📄 artifact-panel.tsx\n📄 preview-with-file-tree.tsx"],
    ["2.2", "SlidesPreview (PPT/PPTX) — OfficeCLI", "完了", "高", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,pptx", "viewers/slides-viewer.tsx",
     "📄 apps/app/src/react-app/domains/session/artifacts/viewers/slides-viewer.tsx"],
    ["2.3", "DocumentPreview (DOCX) — Mammoth", "完了", "高", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,docx", "viewers/document-viewer.tsx",
     "📄 apps/app/src/react-app/domains/session/artifacts/viewers/document-viewer.tsx"],
    ["2.4", "SpreadsheetPreview (XLSX) — SheetJS", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,xlsx", "viewers/spreadsheet-viewer.tsx",
     "📄 apps/app/src/react-app/domains/session/artifacts/viewers/spreadsheet-viewer.tsx"],
    ["2.5", "DiffViewer (side-by-side)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,diff", "viewers/diff-viewer.tsx",
     "📄 apps/app/src/react-app/domains/session/artifacts/viewers/diff-viewer.tsx"],
    ["2.6", "CodePreview — Shiki syntax highlight", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,code", "Shiki 4.0, 80+ langs",
     "📄 apps/app/src/lib/shiki.ts"],
    ["2.7", "PDF / Image / Video / Audio preview", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,media", "Native browser elements",
     "📄 preview.tsx (dòng ~200-250)"],
    ["2.8", "Inline text editor (CodeMirror)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,editor", "artifact-text-editor.tsx",
     "📄 apps/app/src/react-app/domains/session/artifacts/artifact-text-editor.tsx"],
    ["2.9", "Inline spreadsheet editor (SheetJS)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,editor", "artifact-spreadsheet-editor.tsx + .ts",
     "📄 artifact-spreadsheet-editor.tsx\n📄 artifact-spreadsheet-model.ts"],
    ["2.10", "File classification (80+ extensions)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,classify", "open-target.ts",
     "📄 apps/app/src/react-app/domains/session/artifacts/open-target.ts"],
    ["2.11", "Icon mapping (file type → lucide icon)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "preview,icon", "artifact-icon.tsx",
     "📄 apps/app/src/react-app/domains/session/artifacts/artifact-icon.tsx"],
    ["2.12", "Preview limits (5MB)", "完了", "低", "Nhân",
     "", "", "2026-07-11", 4, 100, "", "preview,limits", "preview-limits.ts",
     "📄 apps/app/src/react-app/domains/session/artifacts/preview-limits.ts"],
    ["2.13", "Multi-tab drag reorder", "未着手", "低", "Nhân",
     "", "", "", 4, 0, "2.1", "ui,tabs", "Kéo thả tab artifact panel",
     "🔗 aionui:packages/desktop/src/renderer/.../PreviewTabs.tsx"],

    # === PHASE 2: SKILLS ===
    ["3.0", "Phase 2: Skills / Assistants ✅ DONE (85%)", "完了", "高", "Nhân",
     "", "", "2026-07-11", 160, 85, "", "skill", "40 skills đã có sẵn",
     "📄 .opencode/skills/ (48 folders)\n📄 settings/pages/skills-view.tsx\n📄 apps/server/src/skill-hub.ts"],
    ["3.1", "Skills management UI (Settings)", "完了", "高", "Nhân",
     "", "", "2026-07-11", 24, 100, "", "skill,ui", "skills-view.tsx (1329 loc)",
     "📄 apps/app/src/react-app/domains/settings/pages/skills-view.tsx"],
    ["3.2", "Cloud skill sharing", "完了", "中", "Nhân",
     "", "", "2026-07-11", 16, 100, "", "skill,cloud", "Skill hub server-side",
     "📄 apps/server/src/skill-hub.ts"],
    ["3.3", "Plugin system", "完了", "中", "Nhân",
     "", "", "2026-07-11", 16, 100, "", "skill,plugin", "plugins-view.tsx",
     "📄 apps/app/src/react-app/domains/settings/pages/plugins-view.tsx"],
    ["3.4", "Claude plugin bundle import", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "skill,claude", "claude-plugin-bundle.ts",
     "📄 apps/app/src/lib/claude-plugin-bundle.ts"],
    ["3.5", "Extension registry", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "skill,extension", "extension-config.ts",
     "📄 apps/app/src/lib/extension-config.ts"],
    ["3.6", "Skill research-assistant", "未着手", "高", "Nhân",
     "", "", "", 8, 0, "", "skill,research", "Workflow research + doc reading",
     "📄 .opencode/skills/ (pattern từ skill khác)"],
    ["3.7", "Skill citation-extractor", "未着手", "中", "Nhân",
     "", "", "", 8, 0, "", "skill,citation", "Trích dẫn nguồn tự động",
     "📄 .opencode/skills/ (pattern)"],
    ["3.8", "Skill note-synthesizer", "未着手", "中", "Nhân",
     "", "", "", 8, 0, "", "skill,notes", "Gộp nhiều note thành 1",
     "📄 .opencode/skills/planning-with-files/ (pattern tham khảo)"],

    # === PHASE 3: SCHEDULED TASKS ===
    ["4.0", "Phase 3: Scheduled Tasks ✅ IN PROGRESS (83%)", "進行中", "高", "Nhân",
     "2026-07-11", "", "2026-07-12", 38, 83, "", "cron", "S1-S5 done, còn E2E test",
     "📄 apps/server/src/scheduled/repo.ts\n📄 apps/server/src/scheduled/scheduler.ts\n📄 apps/server/src/scheduled/runner.ts\n📄 apps/server/src/routes/scheduled.ts\n📄 apps/app/.../scheduled/scheduled-tasks-view.tsx"],
    ["4.1", "DB migration: cron_jobs table", "完了", "高", "Nhân",
     "", "", "2026-07-12", 2, 100, "", "cron,db", "schema + repo với CREATE TABLE IF NOT EXISTS",
     "📄 apps/server/src/scheduled/repo.ts"],
    ["4.2", "Cron runner service (croner)", "完了", "高", "Nhân",
     "", "", "2026-07-12", 8, 100, "4.1", "cron,runner", "In-process cron scheduler + test",
     "📄 apps/server/src/scheduled/scheduler.ts"],
    ["4.3", "CRUD API routes", "完了", "高", "Nhân",
     "", "", "2026-07-12", 4, 100, "4.1", "cron,api", "GET/POST/PUT/DELETE /api/scheduled + /api/scheduled/:id/run",
     "📄 apps/server/src/routes/scheduled.ts"],
    ["4.4", "Settings UI page", "完了", "高", "Nhân",
     "", "", "2026-07-12", 12, 100, "4.3", "cron,ui", "List + toggle enable/disable (chưa có create/edit dialog)",
     "📄 apps/app/src/react-app/domains/settings/scheduled/scheduled-tasks-view.tsx\n📄 apps/app/.../sidebar/quick-actions-group.tsx"],
    ["4.5", "Execution engine + conversation relay", "完了", "高", "Nhân",
     "", "", "2026-07-12", 8, 100, "4.2", "cron,exec", "Create session, gửi prompt, skip-overlap, timeout",
     "📄 apps/server/src/scheduled/runner.ts"],
    ["4.6", "E2E test", "未着手", "中", "Nhân",
     "", "", "", 4, 0, "4.1-4.5", "cron,test", "Verify cron chạy đúng giờ", ""],

    # === PHASE 4: REMOTE ACCESS ===
    ["5.0", "Phase 4: Remote Access ⚠️ EARLY (15%)", "未着手", "低", "Nhân",
     "", "", "", 44, 15, "", "channel", "Chỉ có Telegram",
     "📄 apps/app/src/react-app/domains/settings/pages/messaging-view.tsx\n📄 apps/orchestrator/src/"],
    ["5.1", "Telegram integration", "完了", "中", "Nhân",
     "", "", "2026-07-11", 16, 100, "", "channel,telegram", "messaging-view.tsx + Router",
     "📄 app:settings/pages/messaging-view.tsx\n📄 orchestrator/src/"],
    ["5.2", "WebUI server (Bun + QR)", "未着手", "低", "Nhân",
     "", "", "", 16, 0, "", "channel,webui", "Mobile access QR code",
     "🔗 aionui:packages/web-host/src/index.ts\n🔗 aionui:scripts/webui.ts"],
    ["5.3", "WhatsApp channel", "未着手", "低", "Nhân",
     "", "", "", 12, 0, "", "channel,whatsapp", "whatsapp-web.js",
     "🔗 aionui:examples/ext-feishu/channels/ext-feishu-channel.js (channel adapter pattern)"],

    # === PHASE 5: FILE TREE ===
    ["6.0", "Phase 5: File Tree ✅ DONE (85%)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 120, 85, "", "file-tree", "Đã có sẵn",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx\n📄 apps/server/src/routes/files.ts"],
    ["6.1", "FileExplorerPanel (virtual + lazy)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 24, 100, "", "file-tree,ui", "file-explorer-panel.tsx (346 loc)",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx"],
    ["6.2", "Server file API (dir/stat/read/write/...)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 24, 100, "", "file-tree,api", "routes/files.ts",
     "📄 apps/server/src/routes/files.ts"],
    ["6.3", "File sessions + conflict detection", "完了", "中", "Nhân",
     "", "", "2026-07-11", 16, 100, "", "file-tree,sessions", "file-sessions.ts",
     "📄 apps/server/src/services/file-sessions.ts"],
    ["6.4", "Audit trail (file operations log)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "file-tree,audit", "audit.ts",
     "📄 apps/server/src/services/audit.ts"],
    ["6.5", "Side-by-side preview + file tree", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "file-tree,preview", "preview-with-file-tree.tsx",
     "📄 apps/app/src/react-app/domains/session/artifacts/preview-with-file-tree.tsx"],
    ["6.6", "Inbox/Outbox artifact transfer", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "file-tree,transfer", "routes/files.ts inbox/outbox",
     "📄 apps/server/src/routes/files.ts (inbox/outbox sections)"],
    ["6.7", "Context menu (rename/delete/move)", "未着手", "低", "Nhân",
     "", "", "", 4, 0, "6.1", "file-tree,menu", "Click chuột phải",
     "🔗 aionui:packages/desktop/src/renderer/.../WorkspaceContextMenu.tsx"],
    ["6.8", "Batch operations UI", "未着手", "低", "Nhân",
     "", "", "", 4, 0, "6.1", "file-tree,batch", "Select nhiều file", ""],

    # === PHASE 6: VERSION HISTORY ===
    ["7.0", "Phase 6: Version History ✅ DONE (100%)", "完了", "高", "Nhân",
     "", "", "2026-07-12", 26, 100, "", "history", "Hoàn thành — snapshot + API + UI + diff",
     "📄 apps/server/src/file-snapshots.ts\n📄 apps/server/src/snapshot-middleware.ts\n📄 apps/server/src/routes/history.ts\n📄 apps/app/.../file-history-panel.tsx\n📄 apps/app/.../viewers/diff-viewer.tsx"],
    ["7.1", "Revision tracking (mtimeMs:size)", "完了", "高", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "history,revision", "file-sessions.ts",
     "📄 apps/server/src/services/file-sessions.ts"],
    ["7.2", "DiffViewer component", "完了", "高", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "history,diff", "diff-viewer.tsx",
     "📄 apps/app/src/react-app/domains/session/artifacts/viewers/diff-viewer.tsx"],
    ["7.3", "Audit trail", "完了", "高", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "history,audit", "audit.ts",
     "📄 apps/server/src/services/audit.ts"],
    ["7.4", "DB migration: file_snapshots", "完了", "高", "Nhân",
     "", "", "2026-07-12", 2, 100, "", "history,db", "file-snapshots.ts với CREATE TABLE IF NOT EXISTS",
     "📄 apps/server/src/file-snapshots.ts"],
    ["7.5", "Auto-snapshot on save middleware", "完了", "高", "Nhân",
     "", "", "2026-07-12", 4, 100, "7.4", "history,snapshot", "snapshot-middleware.ts + test",
     "📄 apps/server/src/snapshot-middleware.ts"],
    ["7.6", "History API route", "完了", "高", "Nhân",
     "", "", "2026-07-12", 4, 100, "7.4", "history,api", "GET list/diff/content + POST restore",
     "📄 apps/server/src/routes/history.ts"],
    ["7.7", "History UI dropdown", "完了", "高", "Nhân",
     "", "", "2026-07-12", 8, 100, "7.6", "history,ui", "FileHistoryPanel popover — History + All Changes tabs",
     "📄 apps/app/src/react-app/domains/session/artifacts/file-history-panel.tsx\n📄 apps/app/.../hooks/use-file-history.ts"],
    ["7.8", "Diff compare 2 versions", "完了", "中", "Nhân",
     "", "", "2026-07-12", 4, 100, "7.2,7.6", "history,diff", "Server unified-diff + API endpoint",
     "📄 apps/server/src/diff.ts\n📄 apps/server/src/routes/history.ts (diff endpoint)"],

    # === PHASE 7: MULTI-TAB SESSIONS ===
    ["8.0", "Phase 7: Multi-tab Sessions 🔶 PARTIAL (40%)", "未着手", "中", "Nhân",
     "", "", "", 12, 40, "", "sessions", "Có building blocks, cần tab strip",
     "📄 apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx\n📄 panel-tab-store.ts\n📄 side-panel.tsx"],
    ["8.1", "Session sidebar + search/pin/groups", "完了", "中", "Nhân",
     "", "", "2026-07-11", 40, 100, "", "sessions,sidebar", "app-sidebar.tsx (1738 loc)",
     "📄 apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx"],
    ["8.2", "Session groups (store + API)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 24, 100, "", "sessions,groups", "session-management-store.ts + API",
     "📄 apps/app/src/lib/stores/session-management-store.ts\n📄 apps/server/src/routes/sessions.ts"],
    ["8.3", "Side-panel tabs (artifact + browser)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 24, 100, "", "sessions,panels", "panel-tab-store.ts + side-panel.tsx",
     "📄 apps/app/src/lib/stores/panel-tab-store.ts\n📄 apps/app/src/react-app/domains/session/panel/side-panel.tsx"],
    ["8.4", "In-conversation tab strip", "未着手", "中", "Nhân",
     "", "", "", 8, 0, "", "sessions,tabs", "Tab ngang chuyển conversation nhanh",
     "🔗 aionui:.../GroupedHistory/index.tsx\n🔗 aionui:.../GroupedHistory/ConversationRow.tsx"],
    ["8.5", "Drag-drop tab reorder", "未着手", "低", "Nhân",
     "", "", "", 4, 0, "8.4", "sessions,drag", "Dùng motion/react (đã có)",
     "📄 app-sidebar.tsx (motion/react Reorder — pattern có sẵn)"],

    # === PHASE 8: MULTI-AGENT TEAM ===
    ["9.0", "Phase 8: Multi-Agent Team ❌ NONE", "保留", "低", "Nhân",
     "", "", "", 60, 0, "", "team", "Không ưu tiên — phức tạp",
     "🔗 aionui:packages/desktop/src/renderer/pages/team/ (toàn bộ folder)"],
    ["9.1", "DB: teams, team_members, mailbox", "保留", "低", "Nhân",
     "", "", "", 4, 0, "", "team,db", "Schema",
     "🔗 aionui:packages/desktop/src/common/types/team/teamTypes.ts"],
    ["9.2", "ACP SDK integration", "保留", "低", "Nhân",
     "", "", "", 16, 0, "", "team,acp", "@agentclientprotocol/sdk",
     "🔗 aionui:.../platforms/acp/AcpChat.tsx"],
    ["9.3", "Team UI page + chat view", "保留", "低", "Nhân",
     "", "", "", 24, 0, "", "team,ui", "Member cards, slot view",
     "🔗 aionui:.../team/TeamPage.tsx\n🔗 aionui:.../team/TeamChatView.tsx"],
    ["9.4", "Leader delegation logic", "保留", "低", "Nhân",
     "", "", "", 16, 0, "", "team,logic", "Analyze → delegate → summarize",
     "🔗 aionui:.../team/hooks/useTeamSession.ts"],

    # === PHASE 9: MCP MANAGEMENT ===
    ["10.0", "Phase 9: MCP Management ✅ DONE (90%)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 40, 90, "", "mcp", "Full UI + auth + marketplace",
     "📄 apps/app/src/react-app/domains/settings/pages/mcp-view.tsx\n📄 apps/server/src/mcp.ts"],
    ["10.1", "MCP Settings view (list + status)", "完了", "中", "Nhân",
     "", "", "2026-07-11", 16, 100, "", "mcp,ui", "mcp-view.tsx (1262 loc)",
     "📄 apps/app/src/react-app/domains/settings/pages/mcp-view.tsx"],
    ["10.2", "Add MCP modal + auth flows", "完了", "中", "Nhân",
     "", "", "2026-07-11", 16, 100, "", "mcp,auth", "add-mcp-modal.tsx + mcp-auth-modal.tsx",
     "📄 add-mcp-modal.tsx\n📄 mcp-auth-modal.tsx\n📄 mcp-silent-reauth.ts"],
    ["10.3", "Claude plugin import", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "mcp,claude", "claude-plugin-import-modal.tsx",
     "📄 apps/app/src/react-app/domains/connections/modals/claude-plugin-import-modal.tsx"],
    ["10.4", "Server MCP config + cloud plugins", "完了", "中", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "mcp,server", "mcp.ts + cloud-plugins.ts",
     "📄 apps/server/src/mcp.ts\n📄 apps/app/src/lib/cloud-plugins.ts"],

    # === PHASE 10: CUSTOM CSS ===
    ["11.0", "Phase 10: Custom CSS ❌ NONE", "未着手", "中", "Nhân",
     "", "", "", 10, 0, "", "theme", "Easy win — 2 ngày",
     "🔗 aionui:.../AppearanceSettings/CssThemeSettings.tsx\n🔗 aionui:.../AppearanceSettings/CssThemeModal.tsx"],
    ["11.1", "CSS injector utility", "未着手", "中", "Nhân",
     "", "", "", 2, 0, "", "theme,injector", "Inject/eject <style>",
     "🔗 aionui:.../AppearanceSettings/useCustomCSS.ts"],
    ["11.2", "Settings UI (editor + live preview)", "未着手", "中", "Nhân",
     "", "", "", 4, 0, "11.1", "theme,ui", "Code editor + iframe preview",
     "🔗 aionui:.../CssThemeSettings.tsx\n🔗 aionui:.../CssThemeModal.tsx"],
    ["11.3", "Preset themes", "未着手", "低", "Nhân",
     "", "", "", 2, 0, "", "theme,presets", "1-2 theme mẫu",
     "🔗 aionui:.../AppearanceSettings/presets/default.css\n🔗 aionui:.../AppearanceSettings/presets.ts"],
    ["11.4", "Persist to localStorage", "未着手", "中", "Nhân",
     "", "", "", 2, 0, "11.1", "theme,persist", "Lưu CSS giữa sessions",
     "📄 apps/app/src/lib/stores/ (zustand persist pattern)"],

    # === PHASE 11: IMAGE GENERATION ===
    ["12.0", "Phase 11: Image Generation ⚠️ EARLY (25%)", "未着手", "高", "Nhân",
     "", "", "", 14, 25, "", "image-gen", "Priority 2 — extension đã có",
     "📄 apps/app/src/react-app/domains/settings/openai-image-gen-config.tsx\n📄 apps/app/src/lib/extensions/openai-image-extension.ts"],
    ["12.1", "Extension config + settings UI", "完了", "高", "Nhân",
     "", "", "2026-07-11", 8, 100, "", "image-gen,settings", "openai-image-gen-config.tsx",
     "📄 apps/app/src/react-app/domains/settings/openai-image-gen-config.tsx"],
    ["12.2", "Extension registration (image_generate)", "完了", "高", "Nhân",
     "", "", "2026-07-11", 4, 100, "", "image-gen,ext", "openai-image-extension.ts",
     "📄 apps/app/src/lib/extensions/openai-image-extension.ts"],
    ["12.3", "Skill image-gen SKILL.md", "未着手", "高", "Nhân",
     "", "", "", 4, 0, "", "image-gen,skill", ".opencode/skills/image-gen/",
     "🔗 aionui:packages/desktop/src/common/chat/imageGenCore.ts\n📄 .opencode/skills/ppt-creator/SKILL.md (pattern)"],
    ["12.4", "In-chat image render", "未着手", "中", "Nhân",
     "", "", "", 2, 0, "", "image-gen,render", "Hiển thị ảnh trong message",
     "📄 viewers/image-viewer.tsx (đã có)"],
    ["12.5", "Built-in MCP server (optional)", "未着手", "低", "Nhân",
     "", "", "", 8, 0, "", "image-gen,mcp", "MCP server như AionUi",
     "🔗 aionui:packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts\n🔗 aionui:.../imageGenerationMcpEnv.ts"],

    # === PHASE 12: RIGHT PANEL UX ===
    ["13.0", "Phase 12: Right Panel UX (MiniMax-style) ✅ DONE (60%)", "完了", "中", "Nhân",
     "2026-07-11", "", "2026-07-12", 18, 60, "", "ui,panel", "Hợp nhất 2 panel → 1 panel với 3 nút toggle",
     "📄 docs/ux-spec-side-panel-minimax-style.md\n📄 panel/right-panel.tsx\n📄 panel/file-explorer-panel.tsx\n📄 panel/file-explorer-store.ts\n📄 panel/panel-tab-store.ts"],
    ["13.1", "UX Spec đầy đủ (13 bước)", "完了", "中", "Nhân",
     "2026-07-11", "", "2026-07-11", 2, 100, "", "ui,spec", "docs/ux-spec-side-panel-minimax-style.md",
     "📄 docs/ux-spec-side-panel-minimax-style.md"],
    ["13.2", "<RightPanel /> component (3-button toggle)", "完了", "高", "Nhân",
     "2026-07-11", "", "2026-07-11", 4, 100, "13.1", "ui,react", "Files / Preview / Browser + ⋯ + ×",
     "📄 apps/app/src/react-app/domains/session/panel/right-panel.tsx"],
    ["13.3", "Refactor <SessionPage /> mount 1 panel", "完了", "高", "Nhân",
     "2026-07-11", "", "2026-07-11", 3, 100, "13.2", "ui,refactor", "Bỏ switch FileExplorerPanel/SidePanel",
     "📄 apps/app/src/react-app/domains/session/chat/session-page.tsx"],
    ["13.4", "Nút Reload artifact (RefreshCw)", "完了", "中", "Nhân",
     "2026-07-11", "", "2026-07-11", 1, 100, "13.2", "ui,reload", "Header button + invalidate query",
     "📄 apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx"],
    ["13.5", "Auto-reload polling 3s", "完了", "中", "Nhân",
     "2026-07-11", "", "2026-07-11", 2, 100, "13.4", "ui,polling", "statWorkspaceFile + visibility check",
     "📄 apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx"],
    ["13.6", "File tree search (diacritic + multi-word)", "完了", "中", "Nhân",
     "2026-07-11", "", "2026-07-11", 2, 100, "13.2", "ui,search", "Auto-expand kết quả",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx"],
    ["13.7", "'Open in editor' context menu (7 editors)", "完了", "低", "Nhân",
     "2026-07-11", "", "2026-07-11", 2, 100, "13.2", "ui,editor", "VS Code/Cursor/Sublime/WebStorm/IDEA/nvim/vim",
     "📄 apps/app/src/app/lib/desktop.ts\n📄 apps/desktop/electron/main.mjs"],
    ["13.8", "File-explorer-store (persisted per workspace)", "完了", "中", "Nhân",
     "2026-07-11", "", "2026-07-12", 1, 100, "13.2", "ui,store", "Zustand + persist localStorage",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-store.ts"],
    ["13.9", "Persist artifact tabs (key v1→v2)", "完了", "中", "Nhân",
     "2026-07-11", "", "2026-07-12", 1, 100, "13.8", "ui,persist", "Restore tabs khi mở lại session",
     "📄 apps/app/src/react-app/domains/session/panel/panel-tab-store.ts"],
    ["13.10", "Auto-expand ancestor khi mở file", "完了", "中", "Nhân",
     "2026-07-12", "", "2026-07-12", 1, 100, "13.8", "ui,reveal", "expandAncestors(workspaceId, filePath)",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-store.ts"],
    ["13.11", "Sync tree selection với active tab", "完了", "中", "Nhân",
     "2026-07-12", "", "2026-07-12", 1, 100, "13.10", "ui,sync", "Watch activeTabId → highlight + expand",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx"],
    ["13.12", "Bugfix: infinite render loop", "完了", "高", "Nhân",
     "2026-07-12", "", "2026-07-12", 0.5, 100, "13.8", "bugfix", "Hook return array thay vì Set mới",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-store.ts"],
    ["13.13", "Bugfix: tree descendants bị wipe", "完了", "高", "Nhân",
     "2026-07-12", "", "2026-07-12", 0.5, 100, "13.6", "bugfix", "Bỏ effect rebuild tree",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx"],
    ["13.14", "Bugfix: empty state cho returning workspace", "完了", "高", "Nhân",
     "2026-07-12", "", "2026-07-12", 0.5, 100, "13.8", "bugfix", "Luôn setTree khi data load",
     "📄 apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx"],
    ["13.15", "Keyboard shortcuts (Cmd+Shift+F/P/B)", "未着手", "中", "Nhân",
     "", "", "", 1, 0, "13.2", "ui,keyboard", "Mở nhanh 3 mode + Esc/Cmd+. đóng",
     "📄 apps/app/src/react-app/shell/use-shell-shortcuts.ts"],
    ["13.16", "Empty states polish (3 mode)", "未着手", "低", "Nhân",
     "", "", "", 0.5, 0, "13.2", "ui,empty", "Empty state rõ ràng cho files/preview/browser", ""],
    ["13.17", "Optimize polling (1 interval per session)", "未着手", "低", "Nhân",
     "", "", "", 1.5, 0, "13.5", "ui,perf", "Gộp polling thay vì mỗi ArtifactPanel 1 interval", ""],
    ["13.18", "Drag file từ tree vào chat", "未着手", "中", "Nhân",
     "", "", "", 2.5, 0, "13.2", "ui,drag", "@file/path mention khi kéo thả", ""],

    # === TỔNG KẾT ===
    ["99.0", "TỔNG HỢP", "", "", "", "", "", "", 588, 0, "", "", "", ""],
]

# ====================================================================
# WRITE WBS SHEET
# ====================================================================
ws = wb["WBS"]
ws.delete_rows(2, ws.max_row)
ws.title = "WBS"

# Header
for col, h in enumerate(HEADERS, 1):
    ws.cell(row=1, column=col, value=h)
style_header(ws, 1, len(HEADERS))

# Data
for row_idx, row_data in enumerate(DATA, 2):
    for col_idx, val in enumerate(row_data, 1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.border = THIN_BORDER
        cell.alignment = Alignment(vertical='center', wrap_text=True)
    # Status color
    apply_status_style(ws.cell(row=row_idx, column=3), ws.cell(row=row_idx, column=3).value)
    # WBS phase color
    wbs_cell = ws.cell(row=row_idx, column=1)
    if wbs_cell.value:
        prefix = str(wbs_cell.value).split(".")[0]
        if prefix in PHASE_COLORS:
            wbs_cell.fill = PHASE_COLORS[prefix]

# Column widths
widths = [10, 45, 20, 10, 15, 14, 14, 14, 12, 8, 14, 18, 30, 55]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[get_column_letter(i)].width = w

ws.auto_filter.ref = f"A1:N{len(DATA)+1}"
ws.freeze_panes = "B2"  # freeze WBS column

# ====================================================================
# TỔNG QUAN SHEET
# ====================================================================
if "Tong quan" in wb.sheetnames:
    tq = wb["Tong quan"]
else:
    tq = wb.create_sheet("Tong quan")
tq.delete_rows(1, tq.max_row)

done_count = sum(1 for d in DATA if d[2] in ("完了", "DONE", "Hoàn thành"))
total_count = len([d for d in DATA if d[0] and d[0] != "99.0" and d[0].count(".") >= 1])

summary_data = [
    ["TỔNG QUAN DỰ ÁN", "", "", ""],
    ["", "", "", ""],
    ["Dự án:", "OpenWork fork tích hợp AionUi", "", ""],
    ["Mục tiêu:", "File preview + Skills + Version History + Cron", "", ""],
    ["Bắt đầu:", "2026-07-11", "", ""],
    ["Deadline:", "2026-09-30", "", ""],
    ["Owner:", "Nhân", "", ""],
    ["", "", "", ""],
    ["PHASE", "TRẠNG THÁI", "DONE/TOTAL", "EFFORT (h)"],
    ["1. File Preview", "✅ DONE (90%)", "12/13", 120],
    ["2. Skills / Assistants", "✅ DONE (85%)", "5/9", 160],
    ["3. Scheduled Tasks", "✅ IN PROGRESS (83%)", "5/6", 38],
    ["4. Remote Access", "⚠️ EARLY (15%)", "1/3", 44],
    ["5. File Tree", "✅ DONE (85%)", "6/8", 120],
    ["6. Version History", "✅ DONE (100%)", "8/8", 26],
    ["7. Multi-tab Sessions", "🔶 PARTIAL (40%)", "3/5", 12],
    ["8. Multi-Agent Team", "❌ NONE (0%)", "0/5", 60],
    ["9. MCP Management", "✅ DONE (90%)", "4/4", 40],
    ["10. Custom CSS", "❌ NONE (0%)", "0/4", 10],
    ["11. Image Generation", "⚠️ EARLY (25%)", "2/5", 14],
    ["12. Right Panel UX (MiniMax-style)", "✅ DONE (60%)", "14/18", 18],
    ["", "", "", ""],
    ["TỔNG", "", f"{done_count}/{total_count}", 613],
    ["", "", "", ""],
    ["Ghi chú:", "Cột Reference Files chứa đường dẫn file cần đọc", "", ""],
    ["📄 = file trong OpenWork", "🔗 = file trong AionUi cần port", "", ""],
]

for row_idx, row_data in enumerate(summary_data, 1):
    for col_idx, val in enumerate(row_data, 1):
        cell = tq.cell(row=row_idx, column=col_idx, value=val)
        if row_idx <= 2 or row_idx == 9:
            cell.font = Font(bold=True, size=12)

tq.column_dimensions['A'].width = 30
tq.column_dimensions['B'].width = 30
tq.column_dimensions['C'].width = 18
tq.column_dimensions['D'].width = 12

# ====================================================================
# SAVE
# ====================================================================
wb.save(WB_PATH)
print(f"✅ Updated {WB_PATH}")
print(f"   WBS sheet: {len(DATA)} rows, {len(HEADERS)} columns (added Reference Files)")
print(f"   Sheet Tong quan: added")
print(f"   Tasks: {done_count}/{total_count} done")
