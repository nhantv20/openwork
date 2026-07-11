# UX Spec — Right Side Panel: MiniMax-style Toggle

> Status: Draft v0.2 (reviewed)
> Owner: TBD
> Target: OpenWork desktop app (`apps/app`)
> Goal: Layout dễ dùng, dễ đóng mở, đầy đủ chức năng preview/files/browser — tham khảo MiniMax Code (3 nút toggle: Review / Terminal / View File).

---

## TL;DR

Hợp nhất **2 panel phải riêng biệt** (file explorer + side panel) thành **1 panel duy nhất** với **3 nút toggle exclusive** ở header (`Files` / `Preview` / `Browser`) + nút `×` đóng. Click nút đang active = đóng panel. Mặc định **đóng**, chat full width. Thêm nút Reload + auto-reload cho file preview.

Phạm vi: **chỉ UI layout + state machine + reload**. Không đụng viewer, editor, terminal, voice, extensions.

---

## 1. Vấn đề hiện tại (từ observation + code)

### 1.1. UX đang có

User mở OpenWork, click 1 file trong chat → phát sinh tới 4 vùng cùng hiện:

| Vùng | Nguồn | Mục đích |
|---|---|---|
| Sessions sidebar (trái) | `AppSidebar` | List workspaces / sessions |
| Chat ở giữa | `SessionSurface` | Conversation + composer |
| Side panel phải | `SidePanel` | Tabs: artifact + browser |
| File explorer phải ngoài | `FileExplorerPanel` | Tree workspace files |

Khi vừa mở file preview vừa click vào file tree, 2 vùng phải cùng hiện → chat bị ép còn ~30% width.

### 1.2. Bug từ `apps/app/src/react-app/domains/session/chat/session-page.tsx`

```ts
// Dòng 323
const filesRailActive = activeSidePanel === "files" || activeSidePanel === "preview";
```

Và:

```ts
// Dòng 575-580
const openFilesRailPane = useCallback(() => {
  toggleCurrentSidePanel("files");
}, [toggleCurrentSidePanel]);
const openPreviewRailPane = useCallback(() => {
  toggleCurrentSidePanel("preview");
}, [toggleCurrentSidePanel]);
```

→ `files` và `preview` là 2 giá trị enum **khác nhau** trong `SidePanelItem` (`ui-state-store.ts`), nhưng cả 2 map vào cùng behavior (mở cùng ResizablePanel thứ 3). User nhấn 2 nút trên rail thì cùng 1 panel chỉ swap mode — gây cảm giác "không có gì xảy ra" hoặc "chồng chéo".

**Quan trọng**: hiện tại `FileExplorerPanel` (file tree) và `SidePanel` (artifact + browser tabs) **render trong cùng 1 ResizablePanel phải** (xem `session-page.tsx` dòng ~1257-1283, nơi dùng ternary `activeSidePanel === "files" ? <FileExplorerPanel /> : <SidePanel />`). Nghĩa là "2 panel" thực chất là 1 panel với 2 mode. Nhưng user vẫn thấy chồng vì **2 tab trên rail swap qua swap lại mà không có visual feedback rõ ràng**.

**Đã verify** (xem §1.4):
- `FileExplorerPanel.onFileSelect` đã được wire đúng (dòng 1283-1297) — single click file trong tree **đÃ mở preview** qua `openTab` + `syncTranscriptArtifacts`. Tức là behavior "click file → mở preview" đã có sẵn, không cần thêm logic.
- Nhưng vẫn bị UX kém vì user không biết mình đang ở mode nào (panel swap giữa tree và tabs mà không có label rõ).

### 1.3. Thiếu

- **Reload file preview**: `ArtifactPanel` dùng `useQuery` với `staleTime: Infinity` (xem `artifact-panel.tsx:138-141`). Nếu agent sửa file qua tool call → file trên disk đã đổi nhưng preview cache cũ. User phải đóng tab + mở lại.
- **File watcher cho preview**: Chưa subscribe `client.onWorkspaceFileChanged` (đã verify không có method này trong `openwork-server.ts`).
- **Nút Reload explicit**: Không có trên header của artifact tab.
- **Toggle rõ ràng**: "Files" vs "Preview" hiện tại là 2 cùng-thứ → user không hiểu khác biệt.

### 1.4. Đã verify

| Câu hỏi | Kết quả | File tham chiếu |
|---|---|---|
| `FileExplorerPanel.onFileSelect` được wire tới đâu? | **Đã wire** ở `session-page.tsx:1283-1297`. Single click mở preview đúng flow. | `apps/app/src/react-app/domains/session/chat/session-page.tsx:1283` |
| `OpenworkServerClient` có `onWorkspaceFileChanged`? | **Không có**. Client dùng request/response, không có watch/subscribe API. | `apps/app/src/app/lib/openwork-server.ts` (1874 dòng, không có method này) |
| `TerminalDock` render ở đâu? | **Panel dưới** (vertical group, panel thứ 2). Không liên quan right panel. | `session-page.tsx:1225-1236` |
| Server có endpoint watch file? | **Có file watcher ở server** (`apps/server/src/reload-watcher.ts`) nhưng chỉ dùng để **reload workspace config** (`fs.watch` trên root + `.opencode`), **không expose qua HTTP cho client**. | `apps/server/src/reload-watcher.ts:1-50` |
| `sidePanelState` trong `ui-state-store` có persist? | Cần check (xem `ui-state-store.ts`). Nếu có → cần migration khi rename. | `apps/app/src/react-app/shell/ui-state-store.ts` |

**Hệ quả cho auto-reload**:
- Vì server không expose watch qua HTTP, **polling client-side** là lựa chọn duy nhất không cần đụng server.
- Có thể dùng `GET /workspace/:id/files/stat?path=...` (cần check có endpoint này không) trả về `{ mtime: number }`, poll mỗi 3s.
- Nếu không có stat endpoint → thêm vào server (1h effort), hoặc dùng `client.readWorkspaceFile()` rồi so sánh hash (chậm hơn nhưng không cần server).

---

## 2. Tham khảo MiniMax Code

3 nút trên header của right panel:

```
┌──────────────────────────────────────────────────┐
│ [Files] [Preview] [Browser]                  [×] │
├──────────────────────────────────────────────────┤
│                                                  │
│   Nội dung thay đổi theo nút active              │
│                                                  │
└──────────────────────────────────────────────────┘
```

- **Files** = file tree (browse workspace)
- **Preview** = preview file đang chọn (split 2 pane: tree + preview, hoặc full preview)
- **Browser** = built-in browser (WebContentsView)
- **×** = đóng panel, chat full width

Trong MiniMax:
- Click "Files" → mở panel, hiện tree. Click file → switch sang "Preview" với file đó.
- Click "Preview" mà chưa có file → empty state, gợi ý chọn file từ tree.
- Click "Browser" → mở browser tab (giống OpenWork hiện tại).
- Click nút đang active → đóng panel.

**3 trạng thái exclusive**, không bao giờ 2 cùng hiện.

---

## 3. Đề xuất layout mới cho OpenWork

### 3.1. State machine

Thay vì enum hiện tại `"panel" | "extensions" | "voice" | "files" | "preview" | null`, gộp thành 1 state exclusive:

```ts
type RightPanelMode = "closed" | "files" | "preview" | "browser" | "extensions" | "voice";
```

Mỗi session có đúng 1 `rightPanelMode` (state trong `ui-state-store.ts:sidePanelState` — chỉ cần rename + đổi type).

**Quy tắc exclusive**: cùng 1 thời điểm chỉ 1 mode active. `rightPanelMode === "closed"` → không mount panel.

### 3.2. Layout mong muốn

```
┌─────────┬──────────────────────────┬─────────────────────────┐
│ Sess.   │  Chat (Agent)            │  Right Panel            │
│ Side    │                          │  ┌─────────────────────┐ │
│ bar     │  - Messages              │  │ Files│Preview│🌐│×│ │
│         │  - Inline preview (mini) │  └─────────────────────┘ │
│ cowork  │  - Composer              │                          │
│  ...    │                          │  ┌─────────────────────┐ │
│         │                          │  │                     │ │
│         │                          │  │   Content theo      │ │
│         │                          │  │   mode đang chọn    │ │
│         │                          │  │                     │ │
└─────────┴──────────────────────────┴─────────────────────────┘
```

- **Right panel** là 1 ResizablePanel duy nhất (đã có), width mặc định 480px, có thể resize.
- **Header** có 3 nút toggle: `Files`, `Preview`, `Browser` + nút `×` đóng panel.
- **Body** render component theo `rightPanelMode`:
  - `"files"` → `<FileTreeView />`
  - `"preview"` → `<ArtifactPreview />` (với tab strip bên trong nếu nhiều file mở)
  - `"browser"` → `<BrowserView />` (giữ nguyên `BrowserPanelContent`)

### 3.3. Khác biệt với hiện tại

| Hiện tại | Mới |
|---|---|
| 4 vùng độc lập (chat + side panel + file explorer + extensions) | 3 vùng (sessions + chat + right panel). Extensions/voice là mode trong right panel, không phải vùng riêng. |
| Tabs trộn lẫn artifact + browser trong 1 strip | Mỗi mode có 1 strip riêng. Tabs chỉ hiện khi mode đó active. |
| File explorer luôn hiện cùng side panel | File tree **chỉ hiện khi mode = "files"**. Mở preview → tree ẩn, chat rộng hơn. |
| "Files" và "Preview" toggle giống nhau | "Files" = tree only. "Preview" = preview only (tab strip + content). |
| Default mở session → panel mở (nếu có tab persist) | Default **closed**. User tự mở. |
| Khi chuyển mode, panel remount hoàn toàn | Khi chuyển mode, **giữ state** của mode cũ (file tree expanded paths, open tabs) — chỉ unmount DOM. |

### 3.4. Hành vi chuyển mode

Hàm toggle 1 nút (gọi `setRightPanelMode` từ store):

```ts
function toggleMode(target: RightPanelMode) {
  if (current === target) {
    set("closed");      // click nút đang active = đóng
  } else {
    set(target);         // switch sang mode mới
  }
}
```

```
click [Files]    → if mode == "files" → "closed"; else → "files"
click [Preview]  → if mode == "preview" → "closed"; else → "preview"
click [Browser]  → if mode == "browser" → "closed"; else → "browser"
click [×]        → "closed" (bất kể mode hiện tại)
click file từ tree hoặc từ chat → "preview" + mở tab mới (force switch, không toggle)
```

**Cố ý KHÔNG tự động switch** từ "files" sang "preview" khi user click file. Lý do: gây nhảy mode bất ngờ. User đã chủ động chọn mode "files" để browse — nếu muốn preview thì click file rồi tự click nút `[Preview]`. Nhưng **nếu click file là double-click** (intent rõ ràng là xem) → switch sang "preview".

Đề xuất: **single click = select file trong tree, double click = open preview**. Hành vi này giống VS Code, Finder.

---

## 4. Mockup ASCII chi tiết

### 4.1. State: `closed` (mặc định)

```
┌─────────┬────────────────────────────────────────────┐
│ Sessions│ Header: [title] [workspace]      [🔔]      │
│         ├────────────────────────────────────────────┤
│ cowork  │                                            │
│  • S1   │                                            │
│  • S2 ◀ │           Chat full width                  │
│  • S3   │           (composer ở dưới)                │
│         │                                            │
│ openw.. │                                            │
│         │                                            │
│         ├────────────────────────────────────────────┤
│ [+ W]   │ Composer: [textarea] [model] [run]         │
└─────────┴────────────────────────────────────────────┘
```

### 4.2. State: `files` (click nút Files)

```
┌─────────┬──────────────────────┬────────────────────┐
│ Sessions│ Header               │ [Files][Preview][🌐][×]│
│         ├──────────────────────┼────────────────────┤
│ cowork  │                      │ 🔍 Search          │
│  • S1   │                      ├────────────────────┤
│  • S2 ◀ │    Chat              │ ▼ .opencode/       │
│  • S3   │    (composer)        │   ▼ skills/        │
│         │                      │     • pptx-creator │
│         │                      │     • research-... │
│         │                      │ • AGENTS.md        │
│         │                      │ • README.md        │
│         │                      │ • package.json     │
└─────────┴──────────────────────┴────────────────────┘
       Chat ~55%               File tree ~25%
```

### 4.3. State: `preview` (click nút Preview, có file đang mở)

```
┌─────────┬──────────────────────┬────────────────────┐
│ Sessions│ Header               │ [Files][Preview][🌐][×]│
│         ├──────────────────────┼────────────────────┤
│ cowork  │                      │ [CODE.md ×] [+]    │
│  • S1   │                      ├────────────────────┤
│  • S2 ◀ │    Chat              │ # Code of Conduct  │
│  • S3   │    (composer)        │ ...                │
│         │                      │ (preview content)  │
│         │                      │                    │
└─────────┴──────────────────────┴────────────────────┘
       Chat ~55%              Preview ~25%
```

Multi-file: tab strip bên trong panel, click `+` mở tab mới (chọn từ file tree hoặc từ command palette).

### 4.4. State: `browser`

```
┌─────────┬──────────────────────┬────────────────────┐
│ Sessions│ Header               │ [Files][Preview][🌐][×]│
│         ├──────────────────────┼────────────────────┤
│ cowork  │                      │ [GitHub ×] [+]     │
│  • S1   │                      ├────────────────────┤
│  • S2 ◀ │    Chat              │ ← → ⟳ [URL bar] × │
│  • S3   │    (composer)        ├────────────────────┤
│         │                      │ (browser content)  │
│         │                      │                    │
└─────────┴──────────────────────┴────────────────────┘
       Chat ~55%              Browser ~25%
```

---

## 5. State machine chi tiết

### 5.1. State enum

```ts
// apps/app/src/react-app/shell/ui-state-store.ts
export type RightPanelMode =
  | "closed"
  | "files"
  | "preview"
  | "browser"
  | "extensions"
  | "voice";
```

### 5.2. Transitions

| Trigger | From | To | Side effect |
|---|---|---|---|
| Click `[Files]` (toggle) | closed | files | mount FileTreeView |
| Click `[Files]` (toggle) | files | closed | unmount panel |
| Click `[Files]` (switch) | preview/browser/extensions/voice | files | remount body, giữ file tree state |
| Click `[Preview]` (toggle) | closed | preview | nếu có tab active → giữ, nếu không → empty state |
| Click `[Preview]` (toggle) | preview | closed | unmount |
| Click `[Preview]` (switch) | files/browser/... | preview | remount body, giữ artifact tab state |
| Click `[Browser]` (toggle) | closed | browser | tạo browser tab mới (giống hiện tại) |
| Click `[Browser]` (toggle) | browser | closed | unmount |
| Click `[×]` | bất kỳ | closed | unmount, giữ state nội bộ |
| Double-click file từ tree | bất kỳ | preview | mở artifact tab, select tab mới |
| Click file mention trong chat | bất kỳ | preview | mở artifact tab, select tab mới |
| Agent gọi `browser.openUrl` | bất kỳ | browser | listen `onPanelOpened` (giống hiện tại) |
| Agent gọi `hide_browser` | browser | closed | listen `onPanelClosed` |
| Click `[Extensions]` (toggle) | bất kỳ | extensions / closed | remount hoặc unmount |
| Click `[Voice]` (toggle) | bất kỳ | voice / closed | remount hoặc unmount |

### 5.3. Persistence

| State | Persist? | Key | Note |
|---|---|---|---|
| `rightPanelMode` per session | **KHÔNG** | — | Mỗi lần mở session → `"closed"`. Lý do: tránh surprise khi user mở session cũ. |
| File tree `expandedPaths` per workspace | **CÓ** | localStorage key mới | Lưu riêng workspace, không theo session. |
| File tree `selectedFile` per workspace | **CÓ** | localStorage key mới | Để lần sau mở tree highlight lại file vừa chọn. |
| Open artifact tabs per session | **CÓ** | `PERSISTED_PANEL_TAB_STORE_KEY` (đã có) | Giữ nguyên logic. |
| Browser tabs per session | **CÓ** | `PERSISTED_PANEL_TAB_STORE_KEY` (đã có) | Giữ nguyên. |
| Last-active file preview tab per session | **CÓ** | suy ra từ `activeTabId` (đã có) | Khi user mở lại mode "preview", focus tab cũ. |

### 5.4. Keyboard shortcuts

| Key | Action | Scope | Conflict check |
|---|---|---|---|
| `Cmd/Ctrl+Shift+F` | Toggle Files mode | global | Đụng browser find-in-page? Browser là WebContentsView nên không. OK. |
| `Cmd/Ctrl+Shift+P` | Toggle Preview mode | global | Đụng VS Code command palette? **KHÔNG** vì OpenWork là app riêng. OK. |
| `Cmd/Ctrl+Shift+B` | Toggle Browser mode | global | OK |
| `Cmd/Ctrl+Shift+E` | Toggle Extensions mode | global | OK |
| `Cmd/Ctrl+.` | Close right panel | global | OK |
| `Cmd/Ctrl+R` | Reload file preview hiện tại | khi mode = preview | **Conflict**: refresh toàn page! Cần dùng `Cmd/Ctrl+Shift+R` thay thế. |
| `Cmd/Ctrl+W` | Đóng tab đang active | khi mode = preview/browser | OK (giống browser tab) |
| `Cmd/Ctrl+Shift+T` | Reopen tab vừa đóng | khi mode = preview/browser | OK |
| `Esc` | Đóng right panel | global | **Conflict**: Esc thường đóng modal. Cần check modal stack trước. |

**Sửa lại sau review**:
- `Cmd/Ctrl+Shift+R` thay cho `Cmd/Ctrl+R` (tránh refresh page).
- `Esc` chỉ đóng right panel khi **không có modal nào đang mở**.

---

## 6. Edge cases & cân nhắc

### 6.1. File preview reload

**Vấn đề**: `ArtifactPanel` dùng `useQuery({ staleTime: Infinity })` (xem `artifact-panel.tsx:138-141`). File thay đổi từ bên ngoài (agent edit, user edit, git pull) → preview cache cũ.

**Giải pháp đề xuất** (3 tầng):

1. **Nút Reload explicit** trên header của artifact tab (cạnh nút `Edit` / `Download` / `X`):

   ```tsx
   <Button
     variant="ghost"
     size="icon-sm"
     onClick={() => queryClient.invalidateQueries({
       queryKey: ["artifact-panel", workspaceId, target.id]
     })}
     aria-label="Reload artifact"
   >
     <RefreshCw />
   </Button>
   ```

2. **Auto-reload qua polling** (đã verify §1.4: server KHÔNG có watch endpoint qua HTTP, nên polling là lựa chọn duy nhất không cần đụng server):
   - Polling `mtime` mỗi 3s khi tab đang visible (`document.visibilityState === "visible"`), pause khi tab ẩn.
   - Server cần trả `{ mtime: number }` cho file. **Cần check** `client.readWorkspaceFile` đã trả `updatedAt` chưa (xem `artifact-panel.tsx:131` — có `result.updatedAt`!). Nếu có → dùng luôn, không cần thêm endpoint.
   - So sánh `data.updatedAt` với `data.updatedAt` mỗi poll. Nếu khác → `queryClient.invalidateQueries`.
   - Cleanup interval khi unmount hoặc tab ẩn.

3. **Stale indicator** trên header khi `data.updatedAt < currentFileMtime`:
   - Hiện badge `● Cập nhật có sẵn` cạnh tên file.
   - Click badge → reload.

**Priority**:
- Phase 2a (must): nút Reload (1) — 30 phút.
- Phase 2b (should): polling fallback (2) — 1 giờ, không cần đụng server.
- Phase 2c (could): stale indicator (3) — 30 phút.

### 6.2. Multi-file preview

**Vấn đề**: Hiện tại artifact tabs mix với browser tabs trong 1 strip. Khi refactor, mỗi mode có strip riêng.

**Giải pháp**: Trong `panel-tab-store.ts`, giữ nguyên `PanelTab` union (`ArtifactPanelTab | BrowserPanelTab`) — chỉ thay đổi cách render. Khi `rightPanelMode === "preview"`, chỉ filter tabs có `type === "artifact"`. Khi `rightPanelMode === "browser"`, chỉ filter `type === "browser"`.

**Edge case**: user mở 3 file preview, switch sang "files" mode, switch lại "preview" → tabs vẫn còn (giữ state). OK.

**Edge case khác**: close 1 tab trong "preview" mode, switch sang "browser", switch lại "preview" → tab đã đóng vẫn đóng (đúng). Nhưng nếu `activeTabId` trỏ vào tab đã đóng → cần fallback về tab đầu tiên (đã có logic ở `panel-tab-store.ts:resolveActiveTabId`).

### 6.3. Voice + Extensions

Voice và Extensions hiện là 2 mode riêng trong `SidePanelItem`. Đề xuất giữ nguyên — chỉ cần hiển thị đủ 5 nút trong header (Files / Preview / Browser / Voice / Extensions) hoặc gộp Voice + Extensions vào menu `⋯` (3 dots) ở góc phải nếu header quá dài.

**Khuyến nghị**: gộp Voice + Extensions vào menu `⋯` vì ít dùng hơn 3 mode chính, tránh header quá đông.

### 6.4. Width resize

Hiện tại dùng `useWorkspaceShellLayout` với `expandedRightWidth: 520, minRightWidth: 320` (xem `session-page.tsx:392-395`). Khi chuyển mode, giữ nguyên width. **Cần test**: nếu user resize khi đang "files", switch sang "preview" → width giữ nguyên? (nên là vậy, vì cùng panel).

### 6.5. Inline preview trong chat (AionUi style)

MiniMax và AionUi có **inline preview trong chat message** (file nhỏ: ảnh, PDF 1 trang, code snippet). OpenWork hiện chỉ preview ở side panel.

**Không thuộc scope spec này** (user yêu cầu "chức năng bên trong tính sau"). Note để phase 2.

### 6.6. Mobile / responsive

Hiện tại dùng `lg:flex-row` trong `session-page.tsx:1026`. Mobile sẽ stack vertically. Right panel ở mobile có thể là bottom sheet. **Không ưu tiên**, chỉ desktop app.

### 6.7. Khi session chưa load xong

Nếu `selectedSessionId === null` (chưa chọn session), 3 nút toggle có nên hiện? **Không** — ẩn cả right panel khi chưa có session. Hiện tại cũng vậy (ResizablePanel thứ 3 chỉ mount khi `sidePanelOpen === true`).

### 6.8. Khi workspace lỗi / mất kết nối

Nếu workspace lỗi (`selectedWorkspaceErrorMessage !== ""`), file tree không load được. Cần empty state rõ ràng: "Không load được file. Kiểm tra kết nối workspace." Hiện `FileExplorerPanel` có branch `error` nhưng chỉ hiện "Unable to load files" — OK nhưng có thể polish thêm.

### 6.9. Race condition: chuyển mode giữa lúc đang fetch

Nếu user click `[Files]` rồi click `[Preview]` ngay khi file tree đang fetch → component unmount trong lúc query đang chạy. Cần cleanup đúng cách trong `useQuery` (TanStack Query tự handle, nhưng verify với custom hooks trong `FileExplorerPanel`).

---

## 7. Code changes cần làm

### 7.1. Files cần sửa

| File | Thay đổi | Effort |
|---|---|---|
| `apps/app/src/react-app/shell/ui-state-store.ts` | Rename `sidePanelState` → `rightPanelMode`. Đổi type `SidePanelItem` → `RightPanelMode`. Thêm helper `toggleMode(mode)`. | 1h |
| `apps/app/src/react-app/domains/session/chat/session-page.tsx` | Xoá `openFilesRailPane` / `openPreviewRailPane` / `openExtensionsRailPane` / `openVoiceRailPane` riêng lẻ. Thay bằng 1 `setRightPanelMode(mode)`. Bỏ `filesRailActive` / `panelRailActive` / etc. Sửa phần render ResizablePanel để chỉ mount 1 component (`<RightPanel />`) thay vì switch giữa `SidePanel` / `FileExplorerPanel`. | 2h |
| `apps/app/src/react-app/domains/session/panel/side-panel.tsx` | Đổi header: thêm 3 toggle buttons `[Files] [Preview] [Browser]` + `[×]`. Body render theo `rightPanelMode`. Có thể cần tạo file mới `right-panel.tsx` thay vì sửa `side-panel.tsx` (sạch hơn). | 1.5h |
| `apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx` | Rename thành `file-tree-view.tsx` cho rõ mode. Không đổi logic nhiều. | 0.5h |
| `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` | Thêm nút `RefreshCw` reload. Thêm polling mtime cho auto-reload. | 1.5h |
| `apps/app/src/react-app/domains/session/panel/use-side-panel-tabs.ts` | Tách `useCreateArtifactTab` (cho mode preview) và `useCreateBrowserTab` (cho mode browser) — để gọi đúng hook theo mode. | 0.5h |

### 7.2. Files KHÔNG cần sửa

- `panel-tab-store.ts` — giữ logic persist y nguyên, chỉ là consumer.
- `ArtifactPanel` body render bên trong — chỉ thêm nút Reload, không refactor viewer.
- Viewers (pdf, slides, document, etc.) — không liên quan.
- `AppSidebar`, `SessionSurface`, composer — không liên quan.

### 7.3. Tests cần thêm / cập nhật

| Test | Loại | File đề xuất |
|---|---|---|
| `ui-state-store.toggleMode()` đúng cho mọi transition | Unit | `ui-state-store.test.ts` (mới) |
| Right panel mount/unmount đúng theo mode | Integration | `right-panel.test.tsx` (mới) |
| Click file trong tree → mở tab + switch mode (nếu double-click) | Integration | `file-tree-view.test.tsx` (mới) |
| Nút Reload invalidate query | Integration | `artifact-panel-reload.test.tsx` (mới) |
| E2E flow: open session → click Files → click file → click Preview → click X | E2E | `e2e/right-panel-flow.test.ts` (mới) |

### 7.4. Migration / backward compat

- `sidePanelState` trong `ui-state-store` đang được persist localStorage (cần check). Nếu có, cần migration: `"panel"` → `"preview"`, `"files"` → `"files"`, `"preview"` → `"preview"`, etc.
- Hoặc bump version key (`openwork:ui-state:v2`) để discard state cũ.

## 8. Acceptance criteria

### 8.1. Functional

- [ ] Mặc định mở session → right panel **đóng**, chat full width.
- [ ] 3 nút toggle `[Files] [Preview] [Browser]` (hoặc 5 nút nếu không gộp voice/extensions) hiện rõ ở header panel khi panel mở.
- [ ] Click `[Files]` (đang closed) → mở panel, hiện file tree.
- [ ] Click `[Files]` (đang files) → **đóng panel**.
- [ ] Click `[Files]` (đang preview/browser) → switch sang files mode, giữ file tree state.
- [ ] Click `[Preview]` → tương tự với preview mode.
- [ ] Click `[Browser]` → tương tự với browser mode.
- [ ] Click `[×]` → đóng panel, set mode = "closed".
- [ ] Single click file trong tree → select file (không switch mode).
- [ ] Double click file trong tree → switch sang "preview" mode + mở artifact tab.
- [ ] Click file mention trong chat (agent output) → switch sang "preview" mode + mở artifact tab.
- [ ] Nút Reload trên artifact tab → fetch lại file, cập nhật content.
- [ ] Auto-reload qua polling mỗi 3s khi file thay đổi từ bên ngoài.
- [ ] Đóng 1 tab trong multi-tab → không ảnh hưởng tab khác.
- [ ] Chuyển mode → unmount DOM nhưng **giữ state** (tabs, expanded paths).

### 8.2. Keyboard

- [ ] `Cmd/Ctrl+Shift+F` toggle files mode.
- [ ] `Cmd/Ctrl+Shift+P` toggle preview mode.
- [ ] `Cmd/Ctrl+Shift+B` toggle browser mode.
- [ ] `Cmd/Ctrl+Shift+R` reload file preview (khi mode = preview).
- [ ] `Cmd/Ctrl+W` đóng tab active (khi mode = preview/browser).
- [ ] `Cmd/Ctrl+.` đóng right panel.
- [ ] `Esc` đóng right panel (chỉ khi không có modal nào).

### 8.3. Non-functional

- [ ] Không có 2 panel phải cùng hiện.
- [ ] Khi chuyển mode, transition animation < 200ms (hoặc không có nếu gây giật).
- [ ] Right panel width nhớ giữa các lần mở (persist `expandedRightWidth`).
- [ ] Polling auto-reload pause khi tab ẩn (`document.visibilityState !== "visible"`).
- [ ] Không memory leak: tất cả query/subscription cleanup khi unmount.

---

## 9. Open questions

1. **Voice + Extensions**: gộp vào menu `⋯` ở header, hay giữ toggle riêng?
   - Đề xuất: gộp vào `⋯` (header gọn, user ít dùng hơn 3 mode chính).
   - Cần xác nhận với team.

2. **Width mặc định**: 520px (hiện tại, `expandedRightWidth: 520`) hay rộng hơn (640-800px) cho preview dễ đọc?
   - Đề xuất: 560px mặc định, min 320, max 800.

3. **Single click vs double click file trong tree**:
   - MiniMax: single click mở preview.
   - VS Code: single click chỉ select, double click mở.
   - Đề xuất: single click = select + mở preview (giống Finder list view). Double click không cần. **Đơn giản hơn cho user non-technical.**

4. **Auto-reload dùng polling hay SSE**?
   - Polling đơn giản, không cần đụng server.
   - SSE hiệu quả hơn nhưng cần check server có hỗ trợ chưa.
   - Đề xuất: **polling trước** (3s interval, pause khi tab ẩn), SSE nâng cấp sau nếu cần.

5. **Có hiển thị "files changed" notification** (toast) khi file preview auto-reload?
   - Có thể gây spam nếu agent edit liên tục.
   - Đề xuất: chỉ hiển thị khi user đang nhìn tab khác (background tab) và có file reload.

---

## 10. Out of scope (ghi nhớ cho phase 2+)

- Inline preview trong chat message (AionUi style).
- Drag file từ tree vào chat để mention.
- Right-click context menu trong file tree (new file, rename, delete).
- Git status indicator trong file tree (modified, untracked, etc.).
- File search across workspace (Cmd+P).
- Split preview (2 file cùng lúc, vertical/horizontal).
- Diff view giữa 2 version của file.
- Bottom terminal dock (`TerminalDock` đã có trong import nhưng cần check render ở đâu — có thể là dock bottom, không phải right panel).
- Version history (theo guide `aionui-to-openwork-port-guide.md` giai đoạn 6).
- Smart file management (sắp xếp, batch rename).

---

## 11. Implementation plan — chia nhỏ, mỗi bước demo được

Nguyên tắc: **mỗi bước build trên bước trước nhưng đứng độc lập**, có thể commit riêng, test riêng, rollback riêng. Mỗi bước đều có **cách verify bằng mắt** (không cần test framework, click thử là thấy).

**Tổng effort ước tính: 8-10 giờ** (~1.5 ngày làm việc tập trung).

---

### Bước 0 — Setup local (15 phút)

**Mục tiêu**: Đảm bảo dev environment chạy được, baseline trước khi sửa.

**Làm**:
- `pnpm install` (nếu chưa).
- `pnpm --filter @openwork/app dev` → mở app, verify session load được, có workspace, agent chạy được.
- Mở DevTools (View → Toggle Developer Tools) để xem console.

**Verify**:
- App mở được, có 1 session, chat với agent OK.
- Right panel hiện tại mở được (click icon panel bên phải), đóng mở OK.

**Nếu fail**: Fix environment trước khi qua bước 1. Đừng vội sửa code.

---

### Bước 1 — Thêm nút Reload vào artifact tab (30 phút) ⭐ **BẮT ĐẦU Ở ĐÂY**

**Mục tiêu**: Fix lỗi "không có reload" user phàn nàn. Bước nhỏ nhất, độc lập, demo được ngay.

**Làm**:
- Mở `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx`.
- Tìm đoạn header buttons (~dòng 285-373), thêm 1 `<Button>` với icon `RefreshCw` (đã có sẵn trong lucide-react) TRƯỚC nút X đóng.
- onClick: `() => queryClient.invalidateQueries({ queryKey: ["artifact-panel", workspaceId, target.id] })`.
- Thêm Tooltip "Reload file".

**Verify**:
1. Mở 1 file preview (vd: README.md).
2. Mở terminal (hoặc editor ngoài), sửa README.md, save.
3. Quay lại app, click nút Reload (vòng tròn) trên header.
4. **Thấy**: content cập nhật theo nội dung mới.
5. Test với file .md, .py, .json để chắc các viewer đều reload OK.

**Risk**: Thấp. Chỉ thêm 1 nút + 1 handler. Không đụng logic khác.

**Rollback**: Revert 1 commit.

---

### Bước 2 — Auto-reload qua polling (1 giờ)

**Mục tiêu**: Không cần click Reload, file tự refresh khi thay đổi.

**Làm**:
- Trong `artifact-panel.tsx`, sau `useQuery` cho file content, thêm `useEffect`:
  ```ts
  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    const interval = setInterval(() => {
      // Gọi readWorkspaceFile với throwOnError: false, so sánh updatedAt
      client.readWorkspaceFile(workspaceId, target.value)
        .then((fresh) => {
          if (fresh.updatedAt && data?.updatedAt && fresh.updatedAt > data.updatedAt) {
            queryClient.invalidateQueries({ queryKey: ["artifact-panel", workspaceId, target.id] });
          }
        })
        .catch(() => {}); // ignore
    }, 3000);
    return () => clearInterval(interval);
  }, [workspaceId, target.value, data?.updatedAt, ...]);
  ```
- Pause khi tab ẩn (đã có check `visibilityState`).

**Verify**:
1. Mở file preview.
2. Sửa file từ bên ngoài (terminal/editor).
3. **Trong 3-5 giây**, preview tự cập nhật, **không cần click gì**.
4. Switch sang tab khác (browser khác), đợi 10s, quay lại → không spam, polling pause đúng.
5. Mở 5 file preview cùng lúc → không thấy app lag (mỗi file 1 interval riêng, có thể tối ưu sau).

**Risk**: Trung bình. Polling liên tục có thể tốn CPU. Nếu thấy lag → tăng interval lên 5s.

**Rollback**: Revert 1 commit, hoặc đơn giản xóa useEffect.

---

### Bước 3 — Refactor state machine: rename + type (45 phút)

**Mục tiêu**: Đổi tên state cho rõ nghĩa, chuẩn bị cho layout mới ở bước sau. **KHÔNG đổi behavior**, chỉ rename.

**Làm**:
- `apps/app/src/react-app/shell/ui-state-store.ts`:
  - Đổi `SidePanelItem` → `RightPanelMode` (vẫn giữ 5 giá trị: `"panel" | "files" | "preview" | "extensions" | "voice"` thêm `"closed"`).
  - Thêm helper `toggleMode(current, target)` trong store.
  - Nếu có persist localStorage, **bump version key** (`openwork:ui-state:v2`) để user cũ không bị break.
- Search & replace toàn project: `SidePanelItem` → `RightPanelMode`, `setSidePanelState` → `setRightPanelMode` (giữ wrapper nếu cần).
- `session-page.tsx`: đổi tên biến `activeSidePanel` → `rightPanelMode`.

**Verify**:
1. App vẫn chạy y hệt trước (không có gì thay đổi về UX).
2. Click các nút toggle rail vẫn hoạt động như cũ.
3. Console không có warning về type.

**Risk**: Trung bình. Rename nhiều chỗ, dễ miss. Làm cẩn thận + dùng TypeScript check sau mỗi batch.

**Rollback**: `git revert` toàn bộ commit (rename thuần tuý, dễ revert).

---

### Bước 4 — Default panel = closed (15 phút)

**Mục tiêu**: Fix "mở session → panel auto mở" nếu có. Default = closed, chat full width.

**Làm**:
- Trong `ui-state-store.ts`, đổi initial state của `rightPanelMode` thành `"closed"` (thay vì persist state cũ).
- Tìm chỗ nào set default = `"preview"` khi mở session → xoá.

**Verify**:
1. Restart app hoặc mở session mới.
2. **Thấy**: right panel **đóng** mặc định, chat full width.
3. Click toggle trên rail vẫn mở được panel bình thường.

**Risk**: Thấp. Chỉ đổi default.

**Rollback**: Revert 1 dòng.

---

### Bước 5 — Đổi header thành 3-button toggle (1.5 giờ)

**Mục tiêu**: Right panel có 3 nút `[Files] [Preview] [Browser]` + `[×]` rõ ràng. Click nút active = đóng.

**Làm**:
- Trong `side-panel.tsx` (~dòng 60-140, phần header), thay vòng 1 row với:
  - 3 `<Button>` cho Files / Preview / Browser, mỗi nút có `variant={rightPanelMode === target ? "default" : "ghost"}` để highlight nút active.
  - 1 `<Button>` cho `×` ở cuối.
- Mỗi nút onClick gọi `toggleMode(current, target)`.
- Style: dùng `@/components/ui/button` có sẵn, icon từ lucide-react (`Folder`, `FileText`, `Globe`).
- Voice/Extensions tạm thời vẫn dùng rail button cũ (chưa gộp vào `⋯` ở bước này).

**Verify**:
1. Mở app, click 1 nút toggle rail → panel mở với header mới có 3 nút.
2. Click `[Files]` → body là file tree. Click `[Files]` lần nữa → **đóng panel** (không phải swap).
3. Click `[Preview]` (khi đang closed) → mở panel, body rỗng (empty state).
4. Click `[Browser]` → mở panel, body là browser.
5. Click nút active (vd đang ở Files) → đóng panel. Click lại Files → mở lại đúng mode Files.

**Risk**: Trung bình-cao. Phải đụng layout chính, dễ vỡ visual. Nên test kỹ với nhiều session.

**Rollback**: Revert 1 commit.

---

### Bước 6 — Gộp `FileExplorerPanel` vào `RightPanel` (1 giờ)

**Mục tiêu**: 1 panel duy nhất, render mode phù hợp. Không còn swap giữa 2 component.

**Làm**:
- Trong `session-page.tsx` (~dòng 1257-1283), thay ternary:
  ```tsx
  // CŨ
  {activeSidePanel === "files" ? <FileExplorerPanel ... /> : <SidePanel ... />}
  
  // MỚI
  {sidePanelOpen ? <RightPanel ... /> : null}
  ```
- Tạo file mới `apps/app/src/react-app/domains/session/panel/right-panel.tsx`:
  ```tsx
  export function RightPanel({ mode, ...props }) {
    if (mode === "files") return <FileExplorerPanel ... />;
    if (mode === "preview") return <SidePanel ... />;  // giữ nguyên SidePanel
    if (mode === "browser") return <SidePanel ... />;
    // ...
  }
  ```
- Move header (3-button toggle) từ `SidePanel` ra `RightPanel`.
- `SidePanel` giữ nguyên body, chỉ bỏ header.

**Verify**:
1. Mở từng mode (Files / Preview / Browser), đảm bảo vẫn render đúng component.
2. Click file từ tree → mở preview tab (đã wire sẵn ở `session-page.tsx:1283`).
3. Click tab trong preview → switch content.
4. Click browser tab → navigate URL.
5. Verify **không còn** tình trạng "click 2 nút rail swap mode mà không thấy gì".

**Risk**: Trung bình. Refactor lớn, cần test nhiều flow.

**Rollback**: Revert 1 commit.

---

### Bước 7 — Keyboard shortcuts (45 phút)

**Mục tiêu**: Cmd+Shift+F/P/B mở nhanh mode, Cmd+. đóng, Esc đóng khi không có modal.

**Làm**:
- File `useShellShortcuts` đã có sẵn (`apps/app/src/react-app/shell/use-shell-shortcuts.ts`). Mở ra xem structure.
- Thêm handlers:
  ```ts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key === "F") { e.preventDefault(); toggleMode("files"); }
      if (e.key === "P") { e.preventDefault(); toggleMode("preview"); }
      if (e.key === "B") { e.preventDefault(); toggleMode("browser"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMode]);
  ```
- Tương tự cho `Cmd+.` (đóng), `Esc` (đóng nếu không có modal).

**Verify**:
1. Đóng panel. Nhấn `Cmd+Shift+F` → mở Files. Nhấn lại → đóng.
2. `Cmd+Shift+P` → mở Preview. `Cmd+Shift+B` → mở Browser.
3. `Cmd+.` → đóng panel bất kể mode.
4. Mở modal (vd permission modal), nhấn `Esc` → **không đóng panel** (chỉ đóng modal).
5. Đóng modal, nhấn `Esc` → đóng panel.

**Risk**: Thấp. Chỉ thêm listener.

**Rollback**: Xoá useEffect.

---

### Bước 8 — Empty states polish (30 phút)

**Mục tiêu**: Mỗi mode có empty state rõ ràng khi chưa có gì.

**Làm**:
- Mode "files" + workspace lỗi: đã có ở `file-explorer-panel.tsx:283-297`. Polish text thêm hướng dẫn.
- Mode "preview" + chưa có tab: hiện illustration + text "Chưa có file nào. Click `[Files]` để chọn file từ workspace, hoặc click file mention trong chat."
- Mode "browser" + chưa có tab: hiện "Chưa có tab. Nhấn `+` để mở URL."

**Verify**:
1. Mở panel từng mode khi chưa có gì.
2. Mỗi mode có empty state dễ hiểu, có hướng dẫn action tiếp theo.

**Risk**: Thấp. UI only.

---

### Bước 9 — Tests (1.5 giờ) — optional, làm sau khi UX ưng

**Mục tiêu**: Có test tự động để sau này không regress.

**Làm**:
- Unit test `toggleMode()` trong `ui-state-store.test.ts` (mới).
- Integration test `<RightPanel />` với React Testing Library: mount, click button, assert mode.
- E2E test (nếu có sẵn playwright/vitest): flow open session → toggle Files → click file → toggle Preview → close.

**Verify**:
- `pnpm test` pass.

**Risk**: Thấp. Test riêng.

---

## Tổng kết plan

| Bước | Effort | Demo được | Risk | Phụ thuộc |
|---|---|---|---|---|
| 0. Setup | 15' | ✓ | - | - |
| **1. Nút Reload** | **30'** | **✓ ngay** | Thấp | - |
| 2. Auto-reload polling | 1h | ✓ | Trung bình | 1 |
| 3. Rename state | 45' | △ (không thấy khác) | Trung bình | - |
| 4. Default closed | 15' | ✓ | Thấp | 3 |
| 5. 3-button toggle | 1.5h | ✓ | Trung bình-cao | 3, 4 |
| 6. Gộp FileExplorerPanel | 1h | ✓ | Trung bình | 5 |
| 7. Keyboard | 45' | ✓ | Thấp | 5, 6 |
| 8. Empty states | 30' | ✓ | Thấp | 6 |
| 9. Tests | 1.5h | △ | Thấp | 1-8 |
| **Tổng** | **~8h** | | | |

**Đề xuất thứ tự**:
1. Làm **Bước 1** ngay hôm nay (30 phút) → bạn test reload → thấy fix bug "không reload" luôn.
2. Nếu thấy OK → làm tiếp **Bước 2** (auto-reload, 1h) → không cần click nữa.
3. Nghỉ, quay lại sau → làm **Bước 3-6** (refactor layout, ~3h) → demo được UX mới.
4. Polish **Bước 7-8** (1h).
5. Tests **Bước 9** (1.5h) nếu muốn.

Mỗi bước đều có thể dừng và merge, không bị phụ thuộc chặt vào nhau.

---

## 12. Review log

**Sửa**:
- Thêm **TL;DR** ở đầu để team scan nhanh.
- Đổi **§1.4** từ "Cần verify" → "Đã verify" + bảng kết quả thực tế (đã grep code, biết chính xác wire ở đâu, server có gì, không có gì).
- **Quan trọng nhất**: phát hiện `FileExplorerPanel.onFileSelect` **đã wire đúng** ở `session-page.tsx:1283-1297` — single click file trong tree **đÃ mở preview**. Vậy nên spec v0.1 mình nhầm về "chưa wire". Đã sửa.
- Phát hiện `TerminalDock` ở **bottom panel** (vertical group), không liên quan right panel → OK.
- Phát hiện `openwork-server.ts` **không có** watch/subscribe API. Server có `reload-watcher.ts` nhưng chỉ để reload workspace config, **không expose qua HTTP**. → Auto-reload **bắt buộc polling client-side**.
- Phát hiện `client.readWorkspaceFile` đã trả `updatedAt` (xem `artifact-panel.tsx:131`) → polling dùng luôn `updatedAt`, không cần thêm endpoint.
- Bổ sung edge case **§6.7** (session chưa load), **§6.8** (workspace lỗi), **§6.9** (race condition).
- Bổ sung **§7.4** (migration / backward compat) — vì rename store key có thể break user cũ.
- Sửa keyboard conflict: `Cmd+R` → `Cmd+Shift+R` (tránh refresh page).
- Sửa Esc behavior: chỉ đóng khi không có modal.
- Phase breakdown chi tiết hơn với PR boundaries.
- Acceptance criteria chia 3 nhóm: Functional / Keyboard / Non-functional.

**Mở** (chưa quyết trong spec — cần user input):
- Voice/Extensions: gộp `⋯` hay toggle riêng (recommend: gộp `⋯`).
- Width mặc định 520 → 560? (recommend: 560).
- Single click vs double click cho file trong tree — đã sửa thành single = select, double = open (recommend). Nhưng user có thể thích single = open luôn (giống Finder).
- Polling interval 3s có ổn không? Có thể thay bằng 5s để giảm tải server.

### v0.1 (initial draft)

- Viết lần đầu dựa trên observation + đọc code.

### v0.3 — review §13 Plan tiếp theo

**Sửa**:
- **Bước 10**: tăng effort từ 30' → 1-1.5h (refactor `ArtifactPanel` + edge case đóng/mở tab + race condition thực tế phức tạp hơn estimate đầu). Đánh dấu là "optional, chỉ làm khi user mở 5+ file".
- **Bước 12**: tăng effort từ 1.5h → 2-2.5h. Bổ sung 5 edge case: drop folder, cursor position, composer disabled, multi-file, file binary. Composer là component phức tạp cần test kỹ.
- **Bước 11**: effort giữ nguyên 20', nhưng đẩy lên ưu tiên 🥈 (polish nhanh, ít risk).
- **Bước 10**: đẩy xuống ưu tiên 4 (chỉ cần nếu user complain về perf).
- **Bước 12**: đẩy lên 🥉 (UX tốt nhất, effort lớn nhưng đáng).
- Thêm **PR breakdown** rõ ràng hơn (PR 1 = search + Voice, PR 2 = drag file, v.v.)
- Bổ sung **edge case cho Bước 9**: tự động expand folder chứa kết quả khi search.
- Tổng effort: 5.5-7h (thay vì 5-6h) — honest hơn về effort thực tế.

---

## 13. Plan tiếp theo — Phase 2 (chia nhỏ, mỗi bước test được)

Phần này mô tả các cải tiến còn lại sau khi Phase 1 (Bước 1-8) đã xong. Mỗi bước độc lập, demo được, rollback được.

**Tổng effort ước tính: ~5.5-7 giờ** (~1.5 ngày làm việc, có thể skip Bước 10).

Nguyên tắc: **mỗi bước build trên bước trước nhưng đứng độc lập**, có cách verify bằng mắt, commit riêng được.

---

### Bước 9 — File tree search (45 phút) ⭐ **Gợi ý bắt đầu ở đây**

**Mục tiêu**: Tìm file nhanh khi workspace nhiều file. Không cần cuộn.

**Làm**:
- Mở `apps/app/src/react-app/domains/session/panel/file-explorer-panel.tsx`
- Thêm `<Input>` (shadcn) ở header, dưới tên workspace. `placeholder="Tìm file..."`.
- State `const [query, setQuery] = useState("")`.
- Lọc `flatNodes` bằng cách match `node.name.toLowerCase().includes(query.toLowerCase())`.
- Highlight phần match (optional, làm sau nếu có thời gian).
- Tự động expand tất cả folder chứa kết quả khi có query.
- Khi clear query → trở về state expand cũ.

**Verify**:
1. Mở panel Files trên workspace có nhiều file.
2. Gõ "read" → chỉ thấy `README.md`.
3. Gõ "package" → thấy `package.json`, `package-lock.json`, các file trong `packages/`.
4. Gõ "không_có" → empty state "Không tìm thấy file".
5. Clear query → tất cả file trở lại.

**Risk**: Thấp. Chỉ filter UI, không đụng state khác.

**Rollback**: Revert 1 commit.

---

### Bước 10 — Optimize auto-reload polling (1-1.5 giờ)

**Mục tiêu**: Hiện tại mỗi `ArtifactPanel` có 1 polling riêng (3s). Mở 10 file → 10 request/3s = ~200 requests/min. Gộp thành 1 polling duy nhất per session để giảm tải server.

**Vấn đề**: Mỗi `ArtifactPanel` mount → 1 `setInterval` riêng. Nhiều file mở → nhiều interval, nhiều request, có thể rate-limit server.

**Làm**:
- Tạo custom hook `useFileWatch(sessionId, filePaths)` trong `apps/app/src/react-app/domains/session/artifacts/use-file-watch.ts`.
- 1 interval duy nhất, scan tất cả `filePaths`, gọi `statWorkspaceFile` cho mỗi file, so sánh `updatedAt`.
- Khi phát hiện thay đổi → `queryClient.invalidateQueries` cho file đó.
- `ArtifactPanel` dùng hook thay vì tự polling.
- Bỏ polling cũ trong `ArtifactPanel` (~dòng 145-193).
- **Edge case**: cần handle khi `filePaths` thay đổi (user đóng/mở tab) → add/remove khỏi watch list. Dùng `useRef<Set<string>>` để track.
- **Edge case**: race condition khi 2 poll cycle cùng chạy → dùng `cancelled` flag như code cũ.

**Verify**:
1. Mở 5 file preview cùng lúc → DevTools Network thấy 5 requests/3s (1 per file, nhưng từ 1 interval thay vì 5). Số lượng giảm không nhiều nhưng 1 interval dễ debug hơn.
2. Sửa 1 file từ ngoài → 5 preview tất cả cập nhật trong 3-5s.
3. Đóng 1 tab preview → polling bỏ file đó.
4. App không lag.
5. Pause khi tab ẩn (giữ behavior cũ).

**Risk**: Trung bình-cao. Phải refactor `ArtifactPanel` + xử lý edge case đóng/mở tab. Test kỹ với multi-tab.

**Rollback**: Revert commit, polling cũ trong `ArtifactPanel` hoạt động lại.

**Cân nhắc**: Nếu chỉ mở 1-2 file preview thì effort 1.5h không đáng. Chỉ làm nếu user thường mở 5+ file. Có thể bỏ qua nếu không cần.

---

### Bước 11 — Gộp Voice + Extensions vào menu `⋯` (20 phút)

**Mục tiêu**: Rail gọn hơn. Hiện có 3 nút: Panel toggle, Voice, Extensions. Gộp 2 nút ít dùng vào menu `⋯` (3 dots) ở góc phải header của `RightPanel`.

**Làm**:
- Trong `right-panel.tsx`, thêm 1 nút `MoreHorizontal` ở góc phải header, cạnh nút `×`.
- Click → dropdown menu với 2 items: "Voice Mode" + "Extensions".
- Mỗi item gọi `setCurrentSidePanel("voice" | "extensions")` tương ứng.
- Xoá nút Voice + Extensions ở rail trong `session-page.tsx`.

**Verify**:
1. Mở app → rail chỉ còn 1 nút Panel toggle (gọn).
2. Click `⋯` ở header panel → dropdown hiện Voice + Extensions.
3. Click Voice → panel mở voice mode.
4. Click Extensions → panel mở extensions.

**Risk**: Thấp. Chỉ chuyển vị trí UI.

**Rollback**: Revert 1 commit.

---

### Bước 12 — Drag file từ tree vào chat (2-2.5 giờ) ⭐ **Giá trị cao**

**Mục tiêu**: Kéo file từ tree, thả vào chat input → tự động thêm `@file/path` vào text. Tiết kiệm thời gian gõ `@` thủ công.

**Làm**:
- Trong `FileNode` component, thêm `draggable={true}` + `onDragStart={(e) => e.dataTransfer.setData("application/x-openwork-file-path", path)}`.
- Trong chat composer, thêm `onDragOver` (preventDefault để cho phép drop) + `onDrop` parse data → insert text vào vị trí cursor.
- **Edge case 1**: Drop folder → có nên expand folder hoặc add nhiều mention? Quyết định: drop folder = chỉ mention folder name (đơn giản).
- **Edge case 2**: Drop ở giữa text vs cuối text → xử lý cursor position (dùng `selectionStart`).
- **Edge case 3**: Drop khi composer đang disabled (vd: agent đang chạy) → ignore.
- **Edge case 4**: Drop nhiều file cùng lúc (multi-select chưa có) → chỉ handle 1 file, multi làm sau.
- **Edge case 5**: Drop file binary (ảnh, PDF) → vẫn insert mention text, agent sẽ tự xử lý.
- Hiển thị placeholder "Thả file để mention" khi đang drag (CSS: border dashed xanh).

**Verify**:
1. Mở panel Files.
2. Kéo file `.md` vào chat → cursor thay đổi, có indicator.
3. Thả giữa text → `@path/to/file.md` insert đúng vị trí.
4. Thả cuối text → insert cuối.
5. Kéo folder → insert tên folder (không expand toàn bộ).
6. Drop khi composer disabled → không insert.
7. Drop file `.png` → vẫn insert mention (không cần preview).

**Risk**: Trung bình-cao. Composer là component phức tạp, có thể conflict với paste handler, focus logic, IME input. Test kỹ trên Mac và Windows.

**Rollback**: Revert commit, dùng cách gõ `@` thủ công như cũ.

---

### Bước 13 — Tests (1.5 giờ) ⭐ **Bảo vệ code**

**Mục tiêu**: Có test tự động để không regress sau này.

**Làm**:
- Unit test `use-file-watch.ts` (hook mới ở Bước 10).
- Integration test `<RightPanel />`: click button → assert mode đúng.
- Integration test `FileExplorerPanel`: search filter, expand/collapse.
- E2E (nếu có playwright): flow mở file → preview → reload.

**Verify**:
- `pnpm test` pass.

**Risk**: Thấp. Test riêng.

---

## 14. Đề xuất thứ tự

| Ưu tiên | Bước | Effort | Lý do |
|---|---|---|---|
| 🥇 | **9. File tree search** | 45' | Impact cao, dễ làm, dùng được ngay, fix vấn đề workspace nhiều file |
| 🥈 | **11. Gộp Voice/Extensions** | 20' | Rail gọn, polish nhanh |
| 🥉 | **12. Drag file → chat** | 2-2.5h | UX rất tốt nhưng effort lớn, nhiều edge case |
| 4 | **10. Optimize polling** | 1-1.5h | Chỉ cần nếu user mở 5+ file preview cùng lúc. Có thể skip |
| 5 | **13. Tests** | 1.5h | Bảo vệ code, làm cuối cùng sau khi UX ổn định |

**Gợi ý flow**:
- **PR 1**: Bước 9 (search) + Bước 11 (gộp Voice/Extensions) — ~1h, demo được UX tốt hơn ngay
- **PR 2**: Bước 12 (drag file) — ~2h, UX tốt nhất
- **PR 3 (optional)**: Bước 10 (optimize polling) — chỉ nếu user complain về perf
- **PR 4 (optional)**: Bước 13 (tests) — bảo vệ trước khi release lớn

Mỗi bước có thể dừng và merge, không bị phụ thuộc chặt vào nhau.

**Thứ tự ưu tiên thay đổi so với bản đầu**:
- Bước 11 đẩy lên 🥈 (effort nhỏ, polish nhanh, làm sau search)
- Bước 10 đẩy xuống 4 (effort lớn, impact không cao trừ khi user complain)

