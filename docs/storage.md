# Storage — Hệ thống lưu trữ của OpenWork

> Tài liệu này mô tả **toàn bộ vị trí dữ liệu được ghi** trong OpenWork, kèm theo
> đường dẫn mặc định cho **bản cài chính thức (production)** và **bản phát triển
> (dev)**, cùng các biến môi trường để điều chỉnh.

OpenWork có **4 process chính** mỗi process có vùng lưu trữ riêng:

| Process                | Quản lý state cho                  | Mặc định thư mục data                          |
| ---------------------- | ---------------------------------- | ---------------------------------------------- |
| `opencode` (engine)    | Sessions, messages, parts, tokens | `~/.local/share/opencode` (Linux)              |
| `openwork-server`      | Workspace config, audit, snapshots | `~/.openwork/openwork-server`                  |
| `openwork-orchestrator`| Spawn managed subprocess, router  | `~/.openwork/openwork-orchestrator`            |
| `opencode-router`      | Telegram/Slack channels            | `~/.openwork/opencode-router`                  |
| Electron shell         | Workspace tokens, app state        | `<userData>/openwork-*`                        |

---

## 1. Tổng quan — Bản đồ lưu trữ

### 1.1. Sơ đồ thư mục mặc định (production, macOS / Linux)

```
~/.openwork/                                       ← OPENWORK_DATA_DIR mặc định
├── openwork-server/
│   └── audit/
│       └── <workspaceId>.jsonl                    ← Audit log JSONL
├── openwork-orchestrator/
│   ├── openwork-orchestrator-state.json           ← Daemon state (port, baseUrl)
│   ├── openwork-orchestrator-auth.json            ← Bootstrap auth
│   ├── opencode-config/                           ← Cấu hình opencode runtime
│   │   ├── opencode.jsonc
│   │   ├── config.json
│   │   └── ...
│   └── opencode-router/
│       └── <workspaceId>/                         ← Per-workspace router state
└── opencode-router/
    ├── opencode-router.json                       ← Config
    ├── opencode-router.db                         ← Router SQLite (channels, identities)
    └── logs/
        └── opencode-router.log                    ← Pino JSON logs

~/.config/openwork/
├── server.json                                     ← Server config (host, port, token, workspaces)
└── runtime.sqlite                                  ← file_snapshots, session_groups, scheduled_jobs

~/.local/share/opencode/                            ← OPENCODE data dir
├── opencode-local.db (hoặc opencode-<channel>.db)  ← Session/message/part tables
├── auth.json
├── mcp-auth.json
└── ...

~/.opencode/                                       ← OPENCODE config dir
├── opencode.jsonc
├── AGENTS.md
└── bin/opencode                                     ← OpenCode binary (managed)
```

### 1.2. Sơ đồ thư mục dev mode (khi chạy `pnpm dev`)

```
$OPENWORK_DATA_DIR/                                ← Mặc định ./.openwork-dev nếu không set
├── opencode-config/                                ← OpenCode runtime config
└── openwork-dev-data/                               ← OPENWORK_DEV_DATA_DIR
    ├── home/                                        ← $HOME cho opencode subprocess
    ├── xdg/
    │   ├── config/opencode/
    │   ├── data/opencode/
    │   │   └── opencode.db                          ← Session/message DB
    │   ├── cache/
    │   └── state/
    └── config/opencode/                             ← OPENCODE_CONFIG_DIR

<project-root>/
└── .opencode/                                       ← Workspace local config
    ├── opencode.jsonc
    └── openwork/
        └── audit.jsonl                              ← Legacy audit fallback
```

### 1.3. Electron Desktop app (production install)

Khi cài qua DMG / MSI / AppImage, các file nằm trong `app.getPath('userData')`:

| Platform | `userData` mặc định                                   |
| -------- | ------------------------------------------------------ |
| macOS    | `~/Library/Application Support/com.differentai.openwork/` |
| Linux    | `~/.config/com.differentai.openwork/`                  |
| Windows  | `%APPDATA%\com.differentai.openwork\`                   |

```
<userData>/
├── openwork-workspaces.json          ← Workspace registry
├── openwork-server-tokens.json       ← Per-workspace client/host/owner tokens
├── openwork-server-state.json        ← Port allocation
├── workspace-state.json              ← Active workspace + UI state
├── openwork-ui-control.json          ← CDP discovery payload
├── opencode-updater-channel.json     ← Stable / alpha channel
├── managed-opencode-workdir/         ← Managed opencode workspace
└── openwork-dev-data/                ← OPENWORK_DEV_DATA_DIR khi dev:electron

~/Library/Logs/com.differentai.openwork/  ← macOS log files (NSLog)
~/Library/Caches/com.differentai.openwork/
~/Library/Preferences/com.differentai.openwork.plist  ← macOS preferences
```

---

## 2. Các biến môi trường quan trọng

Tất cả các biến đều **optional** — không set thì dùng mặc định theo OS.

### 2.1. Đường dẫn data tổng

| Biến                       | Mặc định                                            | Mô tả |
| -------------------------- | --------------------------------------------------- | ----- |
| `OPENWORK_DATA_DIR`        | `~/.openwork/openwork-{server,orchestrator}`        | Thư mục gốc cho OpenWork server + orchestrator. Hỗ trợ `~/` expansion. |
| `OPENWORK_ELECTRON_USERDATA` | `app.getPath('appData')/<APP_ID>`                   | Override `userData` của Electron (chỉ dùng cho dogfooding). |
| `XDG_DATA_HOME`             | `~/.local/share`                                     | Override theo chuẩn XDG. |
| `XDG_CONFIG_HOME`           | `~/.config`                                          | Override theo chuẩn XDG. |
| `XDG_CACHE_HOME`            | `~/.cache`                                           | Override theo chuẩn XDG. |
| `XDG_STATE_HOME`            | `~/.local/state`                                     | Override theo chuẩn XDG. |
| `APPDATA`                   | Platform-specific (Windows)                          | Override `%APPDATA%`. |

### 2.2. Server-specific

| Biến                       | Mặc định                                            | Mô tả |
| -------------------------- | --------------------------------------------------- | ----- |
| `OPENWORK_SERVER_CONFIG`   | `~/.config/openwork/server.json`                    | File config JSON của server. |
| `OPENWORK_RUNTIME_DB`      | `<configDir>/runtime.sqlite`                         | SQLite lưu `file_snapshots`, `session_groups`, `scheduled_jobs`. |
| `OPENWORK_LOG_FORMAT`      | `pretty`                                             | `pretty` hoặc `json` (OTel). |
| `OPENWORK_LOG_REQUESTS`    | `true`                                               | Bật log mỗi HTTP request. |
| `OPENWORK_DEV_LOG_FILE`    | _(unset)_                                            | Bật `POST /dev/log` sink (client → server). |
| `OPENWORK_DEV_MODE`        | _(unset)_                                            | Bật các dev-only routes (`/dev/history/*`, `/dev/log`). |
| `OPENWORK_TOKEN`           | Random ngắn nếu không set                            | Client bearer token. |
| `OPENWORK_HOST_TOKEN`      | Random ngắn nếu không set                            | Host approval token. |
| `OPENWORK_HOST`            | `127.0.0.1`                                          | Bind hostname. |
| `OPENWORK_PORT`            | `8787`                                               | Bind port. |
| `OPENWORK_CORS_ORIGINS`    | `*`                                                  | Comma-separated hoặc JSON array. |
| `OPENWORK_READONLY`        | `false`                                              | Disable write API. |
| `OPENWORK_WORKSPACES`      | _(unset)_                                            | Comma-separated workspace paths. |
| `OPENWORK_APPROVAL_MODE`   | `manual`                                             | `manual` hoặc `auto`. |
| `OPENWORK_APPROVAL_TIMEOUT_MS` | `30000`                                           | Timeout cho approval. |
| `OPENWORK_OPENCODE_BASE_URL` | _(unset)_                                          | OpenCode upstream base URL. |
| `OPENWORK_OPENCODE_DIRECTORY` | _(unset)_                                         | Workspace dir để share. |
| `OPENWORK_OPENCODE_USERNAME`/`PASSWORD` | _(unset)_                          | OpenCode Basic auth. |
| `OPENWORK_ENABLE_SCHEDULER`| `true`                                               | Bật in-process scheduler. |
| `OPENWORK_SANDBOX`         | `none`                                               | `none` / `docker` / `podman`. |
| `OPENWORK_SANDBOX_IMAGE`   | `debian:bookworm-slim`                               | Sandbox image. |
| `OPENWORK_SANDBOX_PERSIST_DIR` | `$OPENWORK_DATA_DIR/sandbox/<wsId>`               | Persistent mount cho sandbox. |
| `OPENWORK_SANDBOX_MOUNT`   | _(unset)_                                            | Comma-separated extra mounts. |
| `OPENWORK_SANDBOX_MOUNT_ALLOWLIST` | `~/.config/openwork/sandbox-mount-allowlist.json` | Allowlist paths cho mounts. |
| `OPENWORK_SANDBOX_MOUNT_OPENCODE_CONFIG` | `1` (hoặc `0` nếu dev mode)               | Mount host OpenCode config vào sandbox. |
| `OPENWORK_DEV_OPENCODE_IMPORT_CONFIG_DIR` | _(unset)_                                | Dev: copy config từ host OpenCode. |
| `OPENWORK_DEV_OPENCODE_IMPORT_DATA_DIR` | _(unset)_                                  | Dev: copy data từ host OpenCode. |

### 2.3. OpenCode engine

| Biến                       | Mặc định                                            | Mô tả |
| -------------------------- | --------------------------------------------------- | ----- |
| `OPENCODE_DATA_DIR`        | Xem `apps/server/src/opencode-db.ts:24–95`        | Override data dir cho OpenCode (opencode.db). |
| `OPENCODE_CHANNEL`         | `local`                                              | Chọn tên file DB: `opencode-local.db` vs `opencode-<channel>.db`. |
| `OPENCODE_DISABLE_CHANNEL_DB` | `false`                                           | Dùng `opencode.db` thay vì `opencode-<channel>.db`. |
| `OPENCODE_DB`              | _(unset)_                                            | Đường dẫn tuyệt đối hoặc relative đến DB. |
| `OPENCODE_TEST_HOME`       | Dev mode: `<dataDir>/openwork-dev-data/home`        | Override `$HOME` cho opencode subprocess. |
| `OPENCODE_CONFIG_DIR`      | Dev mode: `<dataDir>/openwork-dev-data/config/opencode` | Override config dir. |
| `OPENCODE_URL`             | `http://127.0.0.1:4096`                              | URL opencode mà router gọi. |
| `OPENCODE_SERVER_USERNAME`/`PASSWORD` | _(unset)_                                  | Auth cho opencode upstream. |
| `OPENCODE_DIRECTORY`       | _(unset)_                                            | Working directory cho opencode. |

### 2.4. opencode-router

| Biến                       | Mặc định                                            | Mô tả |
| -------------------------- | --------------------------------------------------- | ----- |
| `OPENCODE_ROUTER_DATA_DIR` | `~/.openwork/opencode-router`                        | Thư mục gốc cho router state. |
| `OPENCODE_ROUTER_DB_PATH`  | `<dataDir>/opencode-router.db`                       | SQLite cho channels. |
| `OPENCODE_ROUTER_LOG_FILE` | `<dataDir>/logs/opencode-router.log`                 | Pino destination. |
| `OPENCODE_ROUTER_CONFIG_PATH` | `<dataDir>/opencode-router.json`                   | Config JSON file. |
| `OPENCODE_ROUTER_HEALTH_PORT` / `PORT` | `3005`                                   | Health endpoint. |
| `OPENCODE_ROUTER_MODEL`    | _(unset)_                                            | Model default cho router. |
| `LOG_LEVEL`                | `info`                                               | Pino log level. |
| `PERMISSION_MODE`          | `allow`                                              | `allow` / `deny`. |
| `TELEGRAM_BOT_TOKEN`       | _(unset)_                                            | Legacy single-bot setup. |
| `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | _(unset)_                              | Legacy single-app setup. |
| `TOOL_UPDATES_ENABLED`     | `false`                                              | Enable tool update notifications. |
| `GROUPS_ENABLED`           | `false`                                              | Enable Telegram group support. |
| `TOOL_OUTPUT_LIMIT`        | `1200`                                               | Max tool output chars. |

---

## 3. Bảng dữ liệu & file — Prod vs Dev

### 3.1. Sessions / messages / parts (OpenCode engine)

Lưu trong **`opencode.db`** (SQLite). Server là **thin proxy** — không copy.

| Mode     | Đường dẫn mặc định |
| -------- | ------------------ |
| Prod (no `OPENWORK_DATA_DIR`) | `~/.local/share/opencode/opencode-local.db` (macOS: `~/Library/Application Support/opencode/opencode-local.db`) |
| Prod với `OPENWORK_DATA_DIR` | `$OPENWORK_DATA_DIR/opencode-config/xdg/data/opencode/opencode-local.db` (nếu dùng orchestrator) |
| Dev      | `$OPENWORK_DATA_DIR/openwork-dev-data/xdg/data/opencode/opencode-local.db` |

**Tables**: `session`, `message`, `part`, `session_input`.

Schema đầy đủ: `scripts/opencode-archive/lib/opencode-db.ts:24–82`.

### 3.2. Workspace config & runtime

| File                       | Prod default                              | Dev default                             |
| -------------------------- | ------------------------------------------ | ---------------------------------------- |
| `server.json`              | `~/.config/openwork/server.json`           | `$OPENWORK_SERVER_CONFIG` (nếu set)    |
| `runtime.sqlite`           | `<configDir>/runtime.sqlite`               | `OPENWORK_RUNTIME_DB` (test thường tmp) |

**Tables trong `runtime.sqlite`**:
- `file_snapshots` — auto/manual/agent snapshots của file edits
- `session_group_states` — nhóm session sidebar
- `scheduled_jobs` + `scheduled_job_runs` — cron scheduled jobs
- `runtime_opencode_configs` — runtime OpenCode config per workspace
- `file_session_states` — ephemeral file write tokens

WAL mode + `synchronous=NORMAL` (xem `file-snapshots.ts:229–230`).

### 3.3. Audit log (who-did-what-when)

JSONL append-only, **không có retention policy**, không rotate.

| File                                                  | Mô tả |
| ----------------------------------------------------- | ----- |
| `$OPENWORK_DATA_DIR/openwork-server/audit/<workspaceId>.jsonl` | Primary (prod) |
| `$OPENWORK_DATA_DIR/openwork-server/audit/<workspaceId>.jsonl` | Dev (cùng path, tách theo workspaceId) |
| `<workspaceRoot>/.opencode/openwork/audit.jsonl`       | Legacy fallback (chỉ khi không có workspaceId) |

Mỗi dòng là một `AuditEntry` (actor, action, target, summary, timestamp). ~40 call sites ghi vào.

### 3.4. OpenCode engine — runtime files

| File / Pattern                | Path                                                   | Mode |
| ----------------------------- | ------------------------------------------------------ | ---- |
| Config                        | `<opencode-config-dir>/opencode.jsonc`                 | Prod + Dev |
| Managed binary                | `<userData>/managed-opencode-workdir/.opencode/bin/opencode` | Electron prod |
| Auth                          | `~/.local/share/opencode/auth.json`                    | Prod |
| MCP auth                      | `~/.local/share/opencode/mcp-auth.json`                | Prod |

### 3.5. opencode-router state

```
<dataDir>/
├── opencode-router.db       ← SQLite: channels, identities, agent prompts
├── opencode-router.json     ← JSON config
└── logs/opencode-router.log ← Pino structured logs
```

### 3.6. Orchestrator state

```
<dataDir>/
├── openwork-orchestrator-state.json   ← Daemon port, baseUrl
├── openwork-orchestrator-auth.json    ← Bootstrap credentials
├── opencode-config/                    ← OpenCode runtime config
│   ├── opencode.jsonc
│   └── config.json
├── opencode-router/<workspaceId>/     ← Per-workspace router data
└── sandbox/<workspaceId>/             ← Per-workspace sandbox persist (khi dùng sandbox)
```

### 3.7. Electron Desktop — workspace store

```
<userData>/
├── openwork-workspaces.json       ← Registry tất cả workspaces
├── openwork-server-tokens.json    ← Per-workspace client/host/owner tokens (UUID v4)
├── openwork-server-state.json     ← Port allocation map
├── workspace-state.json           ← Active workspace ID
├── openwork-ui-control.json       ← CDP discovery payload cho UI control
├── opencode-updater-channel.json  ← "stable" | "alpha"
├── managed-opencode-workdir/      ← Workspace managed by Electron
└── (khi dev) openwork-dev-data/   ← Tương tự layout dev mode
```

### 3.8. Browser (renderer process)

| Storage           | Key prefix       | Mục đích |
| ----------------- | ---------------- | ------- |
| `localStorage`    | `openwork.`      | UI prefs, theme, language, drafts, model picks, Den config, server URLs |
| `__openworkDevLogs` | in-memory       | Ring buffer 1500 events |
| `__openworkPerfLogs` | in-memory      | Ring buffer 500 events, rate-limited |
| `window.__openwork` | in-memory       | Inspector (200 events, slices) |
| TanStack Query    | in-memory        | Global cache, `gcTime: 15s` (transcripts) / `Infinity` (pending prompts) |

~30+ `localStorage` keys cho preferences. Xem `apps/app/src/react-app/kernel/platform.tsx:123–124` để biết key prefix.

---

## 4. Đường dẫn theo OS

### 4.1. macOS

```
~/Library/Application Support/com.differentai.openwork/   ← Electron userData
~/Library/Application Support/opencode/                   ← OPENCODE_DATA_DIR (engine)
~/Library/Logs/com.differentai.openwork/                  ← macOS NSLog
~/Library/Caches/com.differentai.openwork/                ← WebView caches
~/Library/Preferences/com.differentai.openwork.plist     ← App preferences
~/.openwork/openwork-server/                              ← Server audit
~/.openwork/openwork-orchestrator/                        ← Orchestrator state
~/.openwork/opencode-router/                              ← Router DB + logs
~/.config/openwork/                                        ← Server config + runtime.sqlite
~/.local/share/opencode/                                   ← OpenCode engine DB
```

### 4.2. Linux

```
~/.config/com.differentai.openwork/      ← Electron userData (theo XDG)
~/.local/share/opencode/                  ← OPENCODE_DATA_DIR
~/.openwork/openwork-server/              ← Server audit
~/.openwork/openwork-orchestrator/        ← Orchestrator state
~/.openwork/opencode-router/              ← Router DB + logs
~/.config/openwork/                       ← Server config + runtime.sqlite
~/.cache/com.differentai.openwork/        ← WebView caches
~/.local/state/com.differentai.openwork/  ← State (theo XDG_STATE_HOME)
```

### 4.3. Windows

```
%APPDATA%\com.differentai.openwork\      ← Electron userData
%LOCALAPPDATA%\com.differentai.openwork\ ← WebView caches
%APPDATA%\opencode\                      ← OPENCODE_DATA_DIR
%APPDATA%\openwork\openwork-server\      ← Server audit (override qua OPENWORK_DATA_DIR)
%APPDATA%\openwork\openwork-orchestrator\
%APPDATA%\openwork\opencode-router\
%APPDATA%\openwork\server.json           ← Server config
%APPDATA%\openwork\runtime.sqlite        ← Runtime DB
```

---

## 5. Log files — prod vs dev

### 5.1. Production

| File                                                           | Format        | Service          |
| -------------------------------------------------------------- | ------------- | ---------------- |
| `process.stdout` (hoặc journald)                                | OTel JSON/pretty | openwork-server |
| `process.stdout`                                                | OTel JSON/pretty | openwork-orchestrator |
| `<routerDataDir>/logs/opencode-router.log`                      | Pino JSON     | opencode-router  |
| `$OPENWORK_DEV_LOG_FILE` (nếu bật)                              | JSONL         | Client debug    |
| `~/Library/Logs/com.differentai.openwork/*.log` (macOS)          | Plaintext     | Electron (NSLog) |
| `<userData>/Crashpad/completed/*.dmp`                          | Binary        | Electron crash   |

### 5.2. Dev mode

Tất cả log ở prod đều có, thêm:
- Vite HMR log: `process.stdout` của `pnpm dev`
- Orchestrator pretty log với màu ANSI
- React DevTools log
- Client debug-logger batched qua `POST /dev/log`

---

## 6. Backup, migration & cleanup

### 6.1. Archive sessions (OpenCode DB)

**Tự động mỗi 24h** bởi `apps/server/src/opencode-archive-runner.ts:43–193`:

```
$XDG_DATA_HOME/opencode-archive/YYYY-MM/<sessionId>/
├── manifest.json
├── session.json
├── messages.jsonl
├── parts.jsonl
├── session_input.jsonl
└── attachments/
```

- Idle ≥ **7 ngày** → export + set `time_archived`
- Archived ≥ **14 ngày** → hard-delete row + `VACUUM` (xem `scripts/opencode-archive/README.md:96–99`)

### 6.2. Snapshot retention

`apps/server/src/file-snapshots.ts:32–35`:
- `MAX_SNAPSHOT_BYTES = 5_000_000` (mỗi snapshot)
- `SNAPSHOT_KEEP_LAST = 200` (per file, LRU trim sau mỗi save — line 346)

### 6.3. Dọn thủ công

```bash
# Reset toàn bộ runtime state (dev thường)
rm -f runtime.sqlite runtime.sqlite-wal runtime.sqlite-shm

# Xóa audit log
rm ~/.openwork/openwork-server/audit/*.jsonl

# Xóa OpenCode session DB (sẽ mất tất cả sessions!)
rm ~/.local/share/opencode/opencode-local.db

# Reset OpenCode DB với archive (prod)
bun scripts/opencode-archive/index.ts  # chạy manual archive trước khi xóa

# Xóa workspace config (Electron)
rm -rf <userData>/openwork-*  # XÓA TẤT CẢ state

# Clear XDG cache (Electron webview)
rm -rf ~/.cache/com.differentai.openwork/
```

### 6.4. Migration giữa các version

- Schema migration `runtime.sqlite` dùng lazy `ALTER TABLE ADD COLUMN` (xem `file-snapshots.ts:200–211`)
- Electron ↔ Tauri share cùng `appId = com.differentai.openwork` (xem `apps/desktop/electron-builder.yml`) → in-place migration OK
- `OPENWORK_ELECTRON_USERDATA` env cho phép chạy song song hai bản cài

---

## 7. Tham chiếu nhanh — Khởi động

### 7.1. Production (Electron app)

```bash
# macOS
open /Applications/MDECowork.app
# Hoặc double-click trong Launchpad

# Linux AppImage
./MDECowork-x86_64.AppImage

# Windows
"MDE Cowork.exe"
```

Data dir: `app.getPath('userData')` (xem OS-specific ở §4).

### 7.2. Production standalone (CLI)

```bash
# openwork-server
pnpm --filter @openwork/server start
# default: --port 8787 --host 127.0.0.1

# openwork-orchestrator
pnpm --filter @openwork/orchestrator start

# opencode-router
pnpm --filter @openwork/opencode-router start
```

### 7.3. Dev mode

```bash
# Toàn bộ stack
pnpm dev

# Từng phần
pnpm --filter @openwork/orchestrator dev
pnpm --filter @openwork/server dev
pnpm --filter @openwork/opencode-router dev
pnpm --filter @openwork/app dev   # vite (web only)

# Với custom data dir
OPENWORK_DATA_DIR=/tmp/ow-dev pnpm dev
```

### 7.4. Inspect

```bash
# List artifacts OpenWork produces
ls -lah ~/.openwork/openwork-server/audit/
ls -lah ~/.config/openwork/runtime.sqlite*

# SQLite queries
sqlite3 ~/.config/openwork/runtime.sqlite \
  "SELECT workspace_id, file_path, datetime(created_at/1000, 'unixepoch')
   FROM file_snapshots ORDER BY created_at DESC LIMIT 10;"

sqlite3 ~/.local/share/opencode/opencode-local.db \
  "SELECT id, title, datetime(time_created/1000, 'unixepoch')
   FROM session ORDER BY time_created DESC LIMIT 5;"
```

---

## 8. Câu hỏi thường gặp

**Q: Mất dữ liệu khi cập nhật app?**
A: Không. Schema migrations là additive. Audit/snapshot/job DB được giữ nguyên qua versions. Archive runner đã chạy cleanup sau 14 ngày.

**Q: Đồng bộ giữa hai máy?**
A: Không native. Cần copy thủ công `$OPENWORK_DATA_DIR` + `~/.config/openwork/runtime.sqlite` + OpenCode DB. Tokens và workspaces riêng biệt mỗi máy.

**Q: Tại sao mỗi process có data dir riêng?**
A: Mỗi process là binary độc lập có thể chạy độc lập (server chạy không cần orchestrator, router chạy không cần server). Tách data giúp scaling, backup, và migration độc lập.

**Q: Có telemetry gửi đi đâu?**
A: PostHog (`phc_4YnPTlDVYPjgwKvLuNxhbHjV5kadgvd7XLzVHWnCXAI`) + Den API `<DEN_API>/v1/telemetry/ingest`. Có thể tắt qua `localStorage.openwork.preferences.analyticsEnabled = false`.

**Q: Làm sao để tăng dung lượng snapshot?**
A: Đổi `MAX_SNAPSHOT_BYTES` và `SNAPSHOT_KEEP_LAST` trong `file-snapshots.ts:32–35`, hoặc giảm bằng cách gọi `POST /workspace/:id/history/snapshot` thay vì auto snapshot.

**Q: Workspace config đâu rồi?**
A: Trong Electron: `<userData>/openwork-workspaces.json`. Trong standalone server: `~/.config/openwork/server.json` (`workspaces[]` field).

**Q: Tại sao dev dùng `openwork-dev-data`?**
A: Để tách hoàn toàn state dev khỏi prod (xem `cli.ts:3017` `OPENWORK_DEV_DATA_DIR = "openwork-dev-data"`). Cùng workspace nhưng opencode subprocess nhìn thấy XDG dirs khác nhau.

---

## Tham chiếu file chính

| File | Nội dung |
| ---- | -------- |
| `apps/server/src/config.ts` | CLI args + env defaults của server |
| `apps/server/src/audit.ts:14–26` | Audit path resolution |
| `apps/server/src/file-snapshots.ts:167–173` | `runtimeDbPath()` resolution |
| `apps/server/src/opencode-db.ts:24–95` | OpenCode DB path candidates |
| `apps/server/src/opencode-archive-runner.ts` | Archive runner |
| `apps/orchestrator/src/cli.ts:2844–2850` | `resolveRouterDataDir()` |
| `apps/orchestrator/src/cli.ts:3003–3044` | `resolveOpencodeStateLayout()` (dev layout) |
| `apps/opencode-router/src/config.ts:228–296` | Router config + env defaults |
| `apps/desktop/electron/main.mjs:111–119` | `app.setPath('userData', ...)` |
| `apps/desktop/electron/runtime.mjs:530–550` | Orchestrator data dir resolution (Electron) |
| `apps/desktop/electron/workspace-store.mjs:115–175` | Workspace store paths |
| `apps/desktop/electron/updater.mjs:43` | Updater channel path |
| `scripts/opencode-archive/README.md` | Archive layout & retention |
