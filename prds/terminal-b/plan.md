# Plan B — Surface Terminal + Bash Card Style

> **Mục tiêu**: Làm cho Terminal trong OpenWork app đúng pattern thị trường (Claude Code Desktop, Cursor, VS Code, Codex) — tức là **tool call output trong chat** render kiểu card Input/Output (giống ảnh tham chiếu), và **panel Terminal** có nút bấm rõ ràng trong header session để mở/đóng ngoài phím tắt.

**Status**: Draft v1
**Owner**: main (Mavis)
**Workspace**: `/Users/trannhan/project/openwork`
**Scope**: Chỉ thay đổi `apps/app/`. Không đụng server / orchestrator.

---

## 1. Bối cảnh & Quyết định

### 1.1 Tình trạng hiện tại
- `apps/app/src/components/tools/bash.tsx` render bash tool call bằng `CollapsibleTool` cũ — chỉ 2 dòng `<pre>` `$ {cmd}` + `{output}`, nền `bg-muted`, mặc định đóng.
- `apps/app/src/react-app/domains/session/terminal/terminal-dock.tsx` đã có sẵn — xterm.js + Electron bridge + share `workspaceRoot`.
- `useShellShortcuts` đã có phím tắt `Cmd/Ctrl+J` toggle `terminalOpen`.
- `session-page.tsx` đã mount `TerminalDock` vào `ResizablePanel` dọc khi `terminalOpen=true`.
- **Thiếu**: (a) nút mở Terminal trong header session, (b) visual indicator trạng thái, (c) card bash tool style mới.

### 1.2 Quyết định thiết kế
- **Bash card**: bỏ `CollapsibleTool` cũ, viết layout mới giống ảnh tham chiếu — header chip "Terminal" + 2 block Input/Output monospace, mặc định mở nếu output ≤ 6 dòng.
- **Surface Terminal**: thêm 1 nút `Terminal` vào header session (bên phải, cạnh `NotificationBell`). Click toggle `terminalOpen`. Trạng thái active highlight (border / màu nền).
- **Không đụng**:
  - `terminal-dock.tsx` — đã đúng pattern thị trường, không cần sửa.
  - `useShellShortcuts` — phím tắt đã đúng (`Cmd/Ctrl+J` khớp VS Code).
  - `Tool` component chung — bash cần layout đặc thù, giữ file riêng là pattern đúng.
  - Server / orchestrator / agent.

### 1.3 Pattern thị trường tham chiếu
| App | Tool call output | Terminal panel |
|---|---|---|
| Claude Code CLI / Desktop | Card Input/Output text | Panel riêng, mở bằng `Ctrl+``/`Cmd+J`/menu |
| Cursor (Agent mode) | Card collapsible text | Integrated terminal share cwd |
| VS Code | Card collapsible text | xterm.js + node-pty, integrated |
| Codex CLI | Tool call text/JSON | Built-in shell |

→ **Kết luận**: Bash tool → text card, Terminal → panel riêng. Không app nào nào embed xterm vào chat message. Đi đúng hướng này.

---

## 2. Deliverables

| # | File | Thay đổi | Effort |
|---|------|----------|--------|
| 1 | `apps/app/src/components/tools/bash.tsx` | Rewrite: card Terminal style với Input/Output block | ~30 phút |
| 2 | `apps/app/src/react-app/domains/session/chat/session-page.tsx` | Thêm nút `Open Terminal` vào header, active state, `aria-pressed` | ~30 phút |
| 3 | `apps/app/src/react-app/domains/session/chat/session-page.tsx` | Pass prop `terminalOpen` + `onTerminalOpenChange` (đã có, kiểm tra) | ~5 phút |
| 4 | `apps/app/src/lib/build-in-tools.ts` | Không đổi (đã có `BashInput`/`BashToolPart`) | 0 |
| 5 | `apps/app/src/react-app/domains/session/terminal/terminal-dock.tsx` | Không đổi | 0 |

**Tổng effort**: ~1 giờ. **Touch points**: 2 file.

---

## 3. Thiết kế chi tiết

### 3.1 Bash tool card mới (file `bash.tsx`)

**Layout:**
```
┌──────────────────────────────────────────────┐
│  [Terminal icon]  Running a command    [⌄]   │  <- trigger row (giống Tool chung)
├──────────────────────────────────────────────┤
│  Input                                        │  <- label uppercase, 10px, gray
│  $ grep -n "routes/files" ... | head -5      │  <- monospace, nền muted
├──────────────────────────────────────────────┤
│  Output                                       │
│  59:import { registerFileRoutes } from ...   │  <- monospace, opacity-80
│  89:} from "./routes/files.js";              │
└──────────────────────────────────────────────┘
```

**Quy tắc**:
- Header: icon `SquareTerminal` + `description` (từ `part.input.description`) + chevron toggle.
- Body: 2 block `Input` / `Output` nếu `state === "output-available"`. Nếu đang chạy (`input-streaming` / `input-available`) chỉ show `Input` + spinner + "Running…".
- Nếu `state === "output-error"`: show `Input` + block `Error` (màu `text-destructive`).
- `description` fallback: nếu rỗng dùng `"Running a command"` (đồng bộ `getToolActivityLabel`).
- **Default open**: mở nếu `output.length <= 6` dòng HOẶC `output.length <= 400` ký tự (heuristic — output ngắn thì lợi khi xem ngay, dài thì gấp lại cho gọn chat).
- **Max height** body: 320px, scroll nếu vượt.
- **Truncate**: dùng `truncateText` từ `components/tools/path.ts` cho description (đồng bộ `tool-activity.ts`).
- **Code block**: KHÔNG dùng `<CodeBlock>` (dùng shiki highlight, chậm với stream). Chỉ `<pre className="font-mono">` thường.
- **A11y**: mỗi block dùng `<fieldset>` + `<legend>` để screen reader đọc đúng.

**Code skeleton** (chỉ để hình dung — không phải final):
```tsx
"use client"
import { SquareTerminalIcon, ChevronDown, LoaderCircle, CircleAlert } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn, truncateText } from "@/lib/utils"
import type { BashToolPart } from "@/lib/build-in-tools"

const isShortOutput = (output: string) =>
  output.split("\n").length <= 6 || output.length <= 400

export function BashTool({ part }: { part: BashToolPart }) {
  const inFlight = part.state === "input-streaming" || part.state === "input-available"
  const isError = part.state === "output-error"
  const output = part.state === "output-available" ? part.output : ""
  const defaultOpen = !inFlight && (isError || isShortOutput(output))
  const description = truncateText(part.input?.description?.trim() || "Running a command", 64)

  return (
    <Collapsible defaultOpen={defaultOpen} className="group">
      <CollapsibleTrigger className="...same as Tool component...">
        <SquareTerminalIcon className="size-3.5" />
        <span className="truncate">{description}</span>
        {inFlight && <LoaderCircle className="size-4 animate-spin" />}
        {isError && <CircleAlert className="text-destructive size-4" />}
        <ChevronDown className="..." />
      </CollapsibleTrigger>
      <CollapsibleContent className="...transition-[height]...">
        <div className="bg-muted mt-2 space-y-3 rounded-lg p-3 text-xs">
          <Block label="Input" command={part.input?.command ?? ""} />
          {part.state === "output-available" && (
            <Block label="Output" content={output} />
          )}
          {isError && "errorText" in part && (
            <Block label="Error" content={part.errorText} destructive />
          )}
          {inFlight && <span className="text-muted-foreground">Running…</span>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Block({ label, content, destructive }: { label: string; content: string; destructive?: boolean }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="text-muted-foreground px-0 text-[10px] font-semibold uppercase tracking-wider">
        {label}
      </legend>
      <pre className={cn(
        "whitespace-pre-wrap wrap-break-word font-mono",
        destructive && "text-destructive"
      )}>
        {content || <span className="text-muted-foreground">(empty)</span>}
      </pre>
    </fieldset>
  )
}
```

### 3.2 Nút "Terminal" trong header session (file `session-page.tsx`)

**Vị trí**: trong `<div className="flex items-center gap-1.5 ...">` (line ~960), đặt **trước** `<NotificationBell />`. Lý do: action chính trước, notification sau (đúng pattern VS Code).

**Props cần** (xác nhận đã có):
- `props.terminalOpen?: boolean` (line 188) ✅
- `props.onTerminalOpenChange?: (open: boolean) => void` (line 189) ✅
- Trong `session-route.tsx` đã wire `setTerminalOpen` (line 1231, 1753) ✅

**Import cần sửa** (line 5, đã có `lucide-react`):
```tsx
// trước
import { Columns2, PanelRight, Settings2, X, Zap } from "lucide-react";
// sau — thêm "Terminal" vào list, KHÔNG tạo import mới
import { Columns2, PanelRight, Settings2, Terminal, X, Zap } from "lucide-react";
```

**Component**:
```tsx
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
const terminalShortcutHint = isMac ? "⌘J" : "Ctrl+J"

// trong header div, trước <NotificationBell />:
<Button
  variant={props.terminalOpen ? "secondary" : "ghost"}
  size="sm"
  onClick={() => props.onTerminalOpenChange?.(!props.terminalOpen)}
  aria-pressed={props.terminalOpen}
  aria-label="Toggle terminal panel"
  title={`Toggle terminal (${terminalShortcutHint})`}
>
  <Terminal className="size-4" />
  <span className="hidden md:inline">Terminal</span>
</Button>
```

**Style**:
- Default: `variant="ghost"`, icon `Terminal` + text "Terminal".
- Active (`terminalOpen=true`): `variant="secondary"`, giữ icon + text. `aria-pressed="true"`.
- Phím tắt: tooltip detect platform — `⌘J` Mac, `Ctrl+J` Windows/Linux.
- Hide text khi `< md` để header không vỡ trên màn hẹp.

**Kiểm tra trước khi sửa**:
- `Button` đã import (chắc chắn — `NotificationBell` + nút Reset dùng nó).
- `lucide-react` đã có sẵn ở line 5, chỉ thêm `Terminal` vào list.

### 3.3 A11y
- Nút Terminal: `aria-pressed`, `aria-label`, focus ring đầy đủ.
- Bash card: mỗi block có `<label>` (visually + screen reader). Dùng `sr-only` cho icon-only nếu cần.
- Phím tắt `Cmd/Ctrl+J` đã có → giữ nguyên, không thêm shortcut mới.

---

## 4. Plan thực thi (tuần tự)

### Step 0 — Verify build commands (5 phút)
- [ ] Xác nhận package name: `@opencode/app` (đã check `apps/app/package.json:2`).
- [ ] Xác nhận scripts trong `apps/app/package.json:6-39`:
  - `dev`: `OPENWORK_DEV_MODE=1 vite`
  - `build`: `vite build`
  - `typecheck`: `tsc -p tsconfig.json --noEmit`
  - `test`: `bun test tests/`
- [ ] Vậy lệnh build đúng là:
  ```bash
  pnpm --filter @opencode/app typecheck
  pnpm --filter @opencode/app build
  ```
- [ ] Nếu có test cho tool components → `pnpm --filter @opencode/app test`. Hiện không thấy test cho `bash.tsx` cụ thể trong `apps/app/tests/` (theo grep) — bỏ qua.

### Step 1 — Viết `bash.tsx` mới (30 phút)
- [ ] Đọc lại `Tool` component (`ui/tool.tsx`) để giữ pattern icon + collapsible.
- [ ] Đọc `truncateText` từ `components/tools/path.ts` — import về `bash.tsx` (đang import `parseFilename` ở grep.tsx).
- [ ] Đọc `BashInput`/`BashToolPart` — chốt union type cho state.
- [ ] Viết `Block` helper + `BashTool` chính theo skeleton 3.1.
- [ ] Verify: `part.state` có các giá trị nào? Check `DynamicToolUIPart` từ `ai` package — đã có trong `build-in-tools.ts:1`. Có: `output-available` | `output-error` | `input-streaming` | `input-available` | `input-pending-processing` (?) — kiểm tra lại khi code.

**Out of scope**:
- Không test thủ công được (cần môi trường agent chạy bash). Sẽ verify sau bằng cách mở 1 session thật trong app, bảo agent chạy `ls -la`, xem card render.

### Step 2 — Thêm nút Terminal vào header (20 phút)
- [ ] Trong `session-page.tsx` line 960, chèn Button trước `<NotificationBell />`.
- [ ] Import `SquareTerminalIcon` nếu chưa có.
- [ ] Style theo spec 3.2.
- [ ] Verify: click → panel hiện, click lại → panel ẩn, `Cmd+J` cũng hoạt động (đã có sẵn).

### Step 3 — Verify build (10 phút)
- [ ] `pnpm install` nếu cần (chắc không — không thêm dep mới).
- [ ] `pnpm --filter @opencode/app typecheck` — chắc chắn không vỡ TS, đặc biệt `BashToolPart` narrowing.
- [ ] `pnpm --filter @opencode/app build` — kiểm tra Vite bundle pass.
- [ ] Nếu có test cho tool components → run `pnpm --filter @opencode/app test`. Hiện không thấy test cho `bash.tsx` cụ thể.

### Step 4 — Verify bằng tay (qua Electron app, nếu user chạy được) (10 phút)
- [ ] Mở session → bấm nút Terminal → panel mở, gõ `pwd` thấy output workspace.
- [ ] Bấm nút lần nữa → panel đóng.
- [ ] `Cmd+J` → vẫn toggle.
- [ ] Trong chat, yêu cầu agent chạy `ls` → card bash render đúng style, mở nếu output ngắn.
- [ ] Yêu cầu agent chạy `cat file_dai_1000_dong.txt` → card bash collapse mặc định, click để xem.

### Step 5 — Commit (5 phút)
- [ ] Commit message: `feat(chat): surface terminal button in session header, restyle bash tool card`
- [ ] Chạy `pnpm evals` / `pnpm fraimz` nếu có rule từ AGENTS.md (kiểm tra trước khi commit).

---

## 5. Rủi ro & Edge cases

| Rủi ro | Xác suất | Giảm thiểu |
|---|---|---|
| `BashToolPart` thiếu field nào đó khi state `input-streaming` | Thấp | Đã có check `part.input?.description?.trim()` ở `tool-activity.ts:52` — pattern an toàn. Áp dụng tương tự trong bash.tsx. |
| `output` undefined khi `state === "output-available"` | Trung bình | Union `BuiltInDynamicToolPart` (`build-in-tools.ts:293-301`) chỉ define `output` trong branch `output-available`. Dùng `part.state === "output-available"` để narrow trước khi đọc `part.output`. Nếu lỗi TS, dùng `in` operator: `"output" in part`. |
| Terminal mở khi chưa có session | Thấp | Hiện `terminalOpen` global ở `session-route.tsx`, mount ở `session-page.tsx:1277`. Có session hay không, panel vẫn mount — chỉ khác `workspaceRoot`. OK cho UX, bỏ qua. |
| Header quá đông nút khi thêm Terminal | Thấp | Hide text khi `<md`; check trên viewport 1280px vẫn vừa. |
| `defaultOpen` heuristic sai (output 7 dòng nhưng user muốn xem) | Thấp | Click để bung là 1 hành động rẻ. Không tối ưu quá. |
| TypeScript lỗi do `part.state` union mở rộng | Trung bình | Khi code, dùng type guard `part.state === "output-available"` để narrow `output`. |
| Notification Bell đè lên Terminal button | Thấp | Kiểm tra visual trên 3 viewport: 1024 / 1280 / 1440. |
| Phím tắt `Cmd+J` xung đột với phím tắt khác | Rất thấp | Đã có sẵn trong `useShellShortcuts`, user đang dùng OK. |

---

## 6. Không làm (Out of Scope)

- ❌ Tạo tool `run_terminal` mới (hướng A) — không app nào làm, overkill.
- ❌ Embed xterm.js vào chat message (hướng C) — trái pattern, gây lag.
- ❌ Thêm server route / PTY mới — `TerminalDock` đã có sẵn bridge Electron.
- ❌ Đổi theme Terminal — đã đẹp, không đụng.
- ❌ Đổi phím tắt — `Cmd+J` đã khớp VS Code.
- ❌ Sửa `Tool` component chung — bash có layout đặc thù, giữ file riêng đúng pattern.
- ❌ Sửa `terminal-dock.tsx` — đã đúng spec.

---

## 7. Tiêu chí Done

- [ ] `bash.tsx` render card style mới: header icon + description, 2 block Input/Output, monospace, default open khi output ngắn, dùng `<fieldset>/<legend>` cho a11y.
- [ ] Nút `Terminal` hiển thị trong header session, click toggle, có active state, tooltip `⌘J`/`Ctrl+J` theo platform.
- [ ] `Cmd/Ctrl+J` vẫn hoạt động (không bị đụng).
- [ ] `pnpm --filter @opencode/app typecheck` pass.
- [ ] `pnpm --filter @opencode/app build` pass.
- [ ] Verify thủ công qua Electron app: terminal mở/đóng + bash card render.
- [ ] Commit sạch, message rõ ràng.

---

## 8. Phụ lục — Files liên quan (tham khảo)

| File | Vai trò | Sửa? |
|---|---|---|
| `apps/app/src/components/tools/bash.tsx` | Tool call output | ✅ Có |
| `apps/app/src/react-app/domains/session/chat/session-page.tsx` | Mount + header | ✅ Có |
| `apps/app/src/components/ui/tool.tsx` | Generic tool UI | ❌ Không (tham khảo) |
| `apps/app/src/components/tools/collapsible-tool.tsx` | Helper cũ | ❌ Không (tham khảo) |
| `apps/app/src/components/ui/collapsible.tsx` | Primitive | ❌ Không (dùng) |
| `apps/app/src/lib/build-in-tools.ts` | Types | ❌ Không |
| `apps/app/src/lib/tool-activity.ts` | Activity labels | ❌ Không (tham khảo) |
| `apps/app/src/components/tools/path.ts` | `truncateText` | ❌ Không (dùng) |
| `apps/app/src/react-app/domains/session/terminal/terminal-dock.tsx` | Panel Terminal | ❌ Không (đã đúng) |
| `apps/app/src/react-app/shell/use-shell-shortcuts.ts` | Phím tắt | ❌ Không (đã có `Cmd+J`) |
| `apps/app/src/react-app/shell/session-route.tsx` | State container | ❌ Không (đã wire) |
