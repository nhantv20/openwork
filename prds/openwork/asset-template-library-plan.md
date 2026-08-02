# Plan: Asset & Template Library

> **Mục tiêu:** Thêm một lớp quản lý **Asset / Template** xuyên suốt OpenWork — agent, skill, plugin, command, marketplace đều có thể tham chiếu đến asset bằng ID ổn định thay vì đường dẫn tuyệt đối. Hỗ trợ nhiều định dạng (markdown, hình ảnh, docx/pptx/xlsx, brand shell, prompt template, JSON config, snippet code, dataset, …), versioning, preview, permission và sync Cloud.
>
> **Owner:** Nhân
> **Trạng thái:** 📌 Planning (rev 0 — proposal)
> **Ngày tạo:** 2026-07-18

---

## 1. Vì sao cần Asset/Template Library

### 1.1. Vấn đề hiện tại

| Bề mặt hiện có | Nó giải quyết gì | Nó **không** giải quyết |
|---|---|---|
| **Skill** (`.opencode/skills/<name>/SKILL.md`) | Hướng dẫn agent theo tên | Không đính kèm **file payload** (ảnh, docx, brand shell…) |
| **Artifact** (`artifacts/*.html` qua server `:26316`) | Output HTML preview của agent | Output dạng stream, không có manifest, không versioning, không share |
| **BrandKit** (`brand-kit/<Name>/{profile.json, template/}`) | Brand shell + provenance | Chỉ một brand duy nhất / workspace, không reference được từ agent |
| **Cloud Team Templates** | Shared workspace setup | Phân phối **toàn bộ** workspace, không phải từng asset |
| **Cloud Marketplace Plugin** | Bundle nhiều skill + MCP | Asset không phải skill/MCP thì không có chỗ đứng |
| **Inbox/Outbox** (`/files/sessions/*`, `.opencode/openwork/inbox|outbox`) | File vào/ra workspace | Không có manifest, không search, không versioning, không preview |
| **Hard-code path** trong prompt / skill | — | Mỗi clone/move đổi đường dẫn → gãy reference |

### 1.2. Use case điển hình

1. **Agent viết báo cáo Word** cần dùng logo + footer template công ty → tham chiếu `asset://company-template/letterhead@2`, **không** phải `/Users/.../brand-kit/Acme/template/shell.docx`.
2. **Skill "Press release"** muốn chèn hình infographic đã duyệt → `read_asset(id="press-kit/hero", version="approved")`.
3. **Team marketing share brand shell + logo + ảnh sản phẩm** từ Cloud → mọi workspace con đều resolve được cùng một `asset://acme/...`.
4. **Agent generate slide deck** cần template công ty + palette → manifest asset chứa cả shell `.pptx` lẫn `colors.json` + `fonts.json`, agent consume cả bundle.
5. **User sửa file trong asset** → snapshot diff + version mới (semver), không ghi đè version cũ.
6. **Audit / compliance**: cần biết **ai** tham chiếu asset nào, **khi nào**, trong **session nào**.

### 1.3. Không phải mục tiêu (Out of scope cho MVP)

- Không thay thế Skill / MCP / Plugin / Command — Asset là lớp **payload + manifest** bổ sung.
- Không thay thế Artifact HTML (vẫn chạy riêng, dùng asset làm input/output nếu muốn).
- Không phải file manager toàn workspace (đó là Files tab).
- Không phải DAM/DAM enterprise (Adobe Experience Manager) — chỉ cần đủ cho AI consume.

---

## 2. Concept cốt lõi

**Asset = manifest + payload(s) + provenance, versioned, scoped, addressable by stable ID.**

```
asset://<scope>/<namespace>/<name>[@<version>]
```

Ví dụ:

```
asset://workspace/acme/letterhead@2
asset://org/acme/hero-image@approved
asset://hub/drawio/aws-architecture@1.3.0
asset://local/notes/meeting-template@latest
```

### 2.1. Bốn scope

| Scope | Storage | Quản lý bởi | Sync |
|---|---|---|---|
| `local` | `~/.config/openwork/assets/` | OpenWork desktop, riêng từng máy | Không |
| `workspace` | `<workspace>/.opencode/assets/` | Thuộc 1 workspace, commit được | Qua workspace export/import |
| `org` | Den server | Org owner / admin | Cloud sync qua `desktop-cloud-sync` |
| `hub` | GitHub raw repo (giống skill hub) | Hub owner | Pull, không push từ desktop |

### 2.2. Ba loại payload

| Loại | Mô tả | Ví dụ |
|---|---|---|
| `file` | Một file đơn lẻ | PNG, PDF, `.docx`, `.json` |
| `bundle` | Nhiều file trong một thư mục | Brand kit gồm `shell.docx` + `colors.json` + `fonts.json` |
| `text` | Nội dung inline (markdown / JSON / prompt) | Prompt template, JSON schema, regex snippet |

### 2.3. Manifest (`manifest.json`)

```jsonc
{
  "id": "acme/letterhead",           // stable ID trong scope (slug)
  "scope": "workspace",              // local | workspace | org | hub
  "name": "Acme Letterhead",
  "kind": "bundle",                  // file | bundle | text
  "version": "2.0.0",                // semver hoặc label "approved"/"draft"
  "mime": "application/vnd.openwork.asset+zip",
  "tags": ["brand", "template", "docx"],
  "description": "Official letterhead template for client reports",
  "createdAt": "2026-07-18T10:00:00Z",
  "createdBy": "user:abc123",
  "updatedAt": "2026-07-18T10:00:00Z",
  "updatedBy": "user:abc123",
  "checksum": "sha256:9a8b…",        // của payload bytes
  "size": 48213,
  "preview": {
    "type": "docx",                  // renderer hint
    "thumbnailAssetId": "acme/letterhead-thumb"
  },
  "files": [
    { "path": "shell.docx", "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { "path": "colors.json", "mime": "application/json" }
  ],
  "permissions": {
    "read": ["workspace", "org"],
    "write": ["owner:abc123"]
  },
  "provenance": {
    "source": "brand-kit:Acme",      // optional - asset gốc
    "chain": "sha256:…"               // giống BrandKit pattern
  }
}
```

**Lưu ý:** `manifest.json` được tạo tự động khi `upsertAsset`, không phải user tự viết.

### 2.4. Reference URI — `asset://...`

Chuẩn hoá một URI scheme để agent, skill, prompt đều dùng chung:

```
asset://workspace/acme/letterhead@2
asset://org/acme/hero-image@approved
asset://hub/drawio/aws-architecture@1.3.0
asset://local/notes/meeting-template@latest
asset://workspace/acme/letterhead#shell.docx        // con trỏ tới file trong bundle
asset://workspace/acme/letterhead@2#colors.json
```

Resolver trả về:

```ts
type ResolvedAsset = {
  manifest: AssetManifest;
  bytes: Buffer;             // cho file/text
  files?: { [path: string]: Buffer }; // cho bundle
  url?: string;              // optional pre-auth download URL (cho renderer)
}
```

---

## 3. Kiến trúc tổng thể

### 3.1. Sơ đồ luồng

```
┌────────────────────────────────────────────────────────────────────┐
│                         DESKTOP APP                                │
│                                                                    │
│  ┌──────────────────┐    ┌────────────────────────┐                 │
│  │ Settings → Assets│    │ Composer (agent chat)  │                 │
│  │ (UI Library)     │    │  /asset reference      │                 │
│  └────────┬─────────┘    └────────────┬───────────┘                 │
│           │                            │                            │
│           ▼                            ▼                            │
│  ┌──────────────────────────────────────────────────┐               │
│  │ openwork-server REST: /workspace/:id/assets/*     │               │
│  └────────┬─────────────────────────────────────────┘               │
└───────────┼─────────────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────────────┐
│                       OPENWORK SERVER                               │
│                                                                    │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │ assets.ts      │  │ workspace-files  │  │ runtime config   │    │
│  │ (CRUD, resolve)│  │ (.opencode/      │  │ store (per-      │    │
│  │                │  │  assets/)        │  │ workspace meta)  │    │
│  └────────┬───────┘  └──────────────────┘  └──────────────────┘    │
│           │                                                        │
│           ▼                                                        │
│  ┌──────────────────────────────────────────────────┐             │
│  │ openwork-extensions-preview (engine plugin)      │             │
│  │   tools: list_assets, read_asset, write_asset,    │             │
│  │          resolve_asset, search_assets            │             │
│  └──────────────────────────────────────────────────┘             │
│           │                                                        │
│           ▼                                                        │
│  ┌──────────────────────────────────────────────────┐             │
│  │ desktop-cloud-sync (org assets ↔ Den)             │             │
│  └──────────────────────────────────────────────────┘             │
└───────────┬─────────────────────────────────────────────────────────┘
            │                                              │
            ▼                                              ▼
   ┌─────────────────┐                            ┌──────────────────┐
   │ Local FS        │                            │ Den (Cloud)      │
   │ ~/.config/      │                            │ /v1/marketplaces │
   │ openwork/assets │                            │ /v1/plugins/...  │
   │ <workspace>/    │                            │ /v1/asset-registry│
   │ .opencode/      │                            │ (new endpoint)   │
   │ assets/         │                            │                  │
   └─────────────────┘                            └──────────────────┘
```

### 3.2. Tích hợp với hệ thống hiện có

| Thành phần hiện có | Tích hợp |
|---|---|
| `ReloadReason` (`apps/server/src/types.ts:155`) | Thêm `"assets"` vào union; `reload-fingerprint.ts` switch thêm case |
| `audit.ts` | `recordAudit({ kind: "asset", action: "upsert", assetId, version })` |
| `events.ts` | `emitReloadEvent({ reason: "assets", workspaceId })` |
| `validators.ts` | `validateAssetManifest`, `validateAssetReference` |
| `frontmatter.ts` | Không dùng (manifest là JSON), nhưng re-export helper parse version |
| `requireApproval` (`server.ts:2184-2256`) | Mọi write đều approval-gated |
| `extensions-export.ts:56-86` (`redactXxxConfig`) | Mở rộng để redact asset content nếu có `secret` marker |
| `cloud-plugins.ts:16` `DenOrgPluginConfigObjectType` | Thêm `"asset"` |
| `desktop-cloud-sync.ts` | Thêm `assets: AssetSnapshot[]` vào `ResourceSnapshot` |
| `hub-skills.ts` (`.opencode/skills/hub-skills/SKILL.md`) | Mirror thành `hub-assets.ts` (GitHub raw catalog) |

### 3.3. So sánh với Skills (lấy làm pattern)

| | Skill | Asset |
|---|---|---|
| Storage | `.opencode/skills/<name>/SKILL.md` | `.opencode/assets/<scope>/<ns>/<id>/<version>/{manifest.json, payload}` |
| Scope | workspace + global + hub | local + workspace + org + hub |
| Manifest | frontmatter (`name`, `description`) | JSON (`manifest.json`) với versioning |
| Hub | GitHub raw (skill-hub.ts) | GitHub raw (asset-hub.ts) — mirror |
| Audit | `recordAudit({ kind: "skill" })` | `recordAudit({ kind: "asset" })` |
| Engine tool | (none — engine loads by file) | `list_assets`, `read_asset`, `write_asset`, `resolve_asset` |

---

## 4. Data model chi tiết

### 4.1. Storage layout (filesystem)

```
<workspace>/.opencode/
└── assets/
    └── workspace/                      # scope=workspace
        └── acme/
            └── letterhead/
                ├── 1.0.0/
                │   ├── manifest.json
                │   ├── shell.docx
                │   └── colors.json
                ├── 2.0.0/
                │   ├── manifest.json
                │   ├── shell.docx
                │   └── colors.json
                └── latest -> 2.0.0     # symlink (POSIX) hoặc pointer file

~/.config/openwork/assets/
└── local/
    └── notes/
        └── meeting-template/
            └── 1.0.0/
                ├── manifest.json
                └── template.md

Den server (cloud):
/v1/orgs/:orgId/asset-registry/
    acme/letterhead/
        versions/
            1.0.0 -> { payloadUrl, manifestUrl }
            2.0.0 -> ...
        latest -> 2.0.0
```

### 4.2. Runtime config

Lưu metadata không nằm trong file (audit, ownership, sync state) vào runtime store đã có:

```
.opencode/openwork/openwork.json:
{
  "authorizedRoots": [...],
  "assets": {
    "installed": {
      "workspace/acme/letterhead": { "version": "2.0.0", "installedAt": "..." }
    },
    "syncState": { ... }
  }
}
```

Hoặc tách hẳn thành `assets-store.ts` (tương tự `openwork-workspace-config-store.ts`) nếu cần atomicity cao hơn.

### 4.3. Reference resolution

```
Input:  "asset://workspace/acme/letterhead@2#colors.json"
            │      │        │       │       │
            │      │        │       │       └─ file path inside bundle (optional)
            │      │        │       └───────── version (optional, default = latest)
            │      │        └───────────────── asset id (ns/name)
            │      └────────────────────────── scope
            └───────────────────────────────── scheme

Resolve:
1. scope = "workspace"
   → read workspace dir
   → find assets/workspace/acme/letterhead/
   → resolve version: "2" → "2.0.0" (semver loose match) hoặc "latest" pointer
   → find file "colors.json" trong bundle
   → return { manifest, bytes, files }
2. scope = "org"
   → fetch from Den cache (Redis hoặc local LRU)
   → if miss, fetch /v1/orgs/:orgId/asset-registry/acme/letterhead
   → download payloadUrl (pre-auth)
   → cache locally at ~/.config/openwork/assets-cache/<orgId>/...
3. scope = "hub"
   → fetch from hub catalog (GitHub raw)
   → cache locally
4. scope = "local"
   → read ~/.config/openwork/assets/local/...
```

---

## 5. Server API surface

Tất cả endpoint theo pattern của `apps/server/src/routes/registry.ts:43` (`addRoute`). Auth mode `"client"` cho workspace-scoped, `"host"` cho admin.

### 5.1. CRUD

```
GET    /workspace/:id/assets
       ?scope=&q=&tag=&kind=&limit=&cursor=
       → { assets: AssetSummary[], nextCursor }

GET    /workspace/:id/assets/:scope/:ns/:name
       ?version=
       → AssetManifest

GET    /workspace/:id/assets/:scope/:ns/:name/versions
       → { versions: AssetVersion[] }

POST   /workspace/:id/assets/:scope/:ns/:name
       body: { manifest, payload: base64 | multipart, version? }
       → AssetManifest (approval-gated)

PATCH  /workspace/:id/assets/:scope/:ns/:name
       body: { manifest patch, newVersion? }
       → AssetManifest (approval-gated, tạo version mới không ghi đè)

DELETE /workspace/:id/assets/:scope/:ns/:name
       ?version=  (omit = delete all versions)
       → 204 (approval-gated)
```

### 5.2. Resolve & Search

```
POST   /workspace/:id/assets/resolve
       body: { references: string[] }     # ["asset://workspace/acme/letterhead@2#colors.json", ...]
       → { results: Array<ResolvedAsset | { error: string, reference: string }> }

GET    /workspace/:id/assets/search
       ?q=&mime=&tag=&scope=
       → AssetSummary[]

POST   /workspace/:id/assets/:scope/:ns/:name/diff
       body: { from: "1.0.0", to: "2.0.0" }
       → { changedFiles: [...], diff: per-file }
```

### 5.3. Preview

```
GET    /workspace/:id/assets/:scope/:ns/:name/preview
       ?version=&file=
       → 200 image/png | text/html | application/json | redirect to artifact renderer
       (cho markdown / json / image / docx — render sang HTML để hiển thị trong UI)
```

### 5.4. Hub

```
GET    /hub/assets
       ?q=&tag=&hub=
       → AssetSummary[] (catalog)

POST   /workspace/:id/assets/hub/install
       body: { hubId: "hub:drawio/aws-architecture", version?: string }
       → AssetManifest (approval-gated, copy về scope=workspace)

POST   /workspace/:id/assets/hub/publish
       body: { scope: "workspace", ns, name, version }
       → AssetManifest (admin only, push lên hub qua GitHub PR hoặc Den registry)
```

### 5.5. Cloud sync (Den ↔ desktop)

```
GET    /workspace/:id/desktop-cloud-sync
       → ResourceSnapshot { assets: AssetSnapshot[] }

POST   /workspace/:id/desktop-cloud-sync
       body: { decisions: { [assetId]: "install" | "sync" | "uninstall" } }
       → 204 (apply changes to local workspace assets)
```

### 5.6. Wire types (cho Den ↔ desktop)

Thêm vào `apps/app/src/app/lib/den-types.ts`:

```ts
type DenAssetSnapshot = {
  id: string;                     // "acme/letterhead"
  scope: "org";
  name: string;
  kind: "file" | "bundle" | "text";
  version: string;
  tags: string[];
  manifestUrl: string;
  payloadUrl: string;
  sizeBytes: number;
  checksum: string;
  updatedAt: string;
}

type DenResourceSnapshot = {
  // existing fields
  assets: DenAssetSnapshot[];
}
```

---

## 6. UI surface

### 6.1. Settings → Assets (tab mới)

Vị trí: cùng tab với `Skills`, `MCP`, `Plugins` trong `apps/app/src/react-app/domains/settings/shell/settings-route.tsx`.

Thêm vào `apps/app/src/app/types.ts:180-201`:

```ts
SETTINGS_TAB_VALUES = [
  "preferences",
  "permissions",
  "skills",
  "scheduled",
  "extensions",
  "artifacts",        // existing — HTML output
  "assets",           // NEW
  "advanced",
] as const
```

Layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Assets                                              [+ New asset]  │
├──────────────┬──────────────────────────────────────────────────────┤
│ Filters      │  Search [____]   Tag [v]   Kind [v]   Scope [v]     │
│              │                                                      │
│ □ Workspace  │  ┌────────────────────────────────────────────────┐   │
│ □ Org        │  │ 📄 acme/letterhead        workspace · v2.0.0 │   │
│ □ Hub        │  │    Official letterhead template             │   │
│ □ Local      │  │    [docx, brand, template]                  │   │
│              │  │    Updated 2 days ago by Nhân               │   │
│ Tags         │  │                                  [Open →]  │   │
│ □ brand      │  └────────────────────────────────────────────────┘   │
│ □ template   │  ┌────────────────────────────────────────────────┐   │
│ □ docx       │  │ 🖼️ acme/hero              workspace · v1.0.0  │   │
│              │  │    ...                                        │   │
└──────────────┴──────────────────────────────────────────────────────┘
```

Asset detail panel:

```
┌──────────────────────────────────────────────────────────────┐
│ ← acme/letterhead                          v2.0.0  [⋮ Menu]   │
├──────────────────────────────────────────────────────────────┤
│ [Preview] [Files] [Versions] [Permissions] [References]      │
├──────────────────────────────────────────────────────────────┤
│  Preview tab:                                                 │
│  ┌────────────────────────────┐  ┌──────────────────────────┐ │
│  │                            │  │ Metadata                 │ │
│  │   [rendered preview]       │  │ ID: acme/letterhead      │ │
│  │   (image / docx / md)      │  │ Scope: workspace         │ │
│  │                            │  │ Version: 2.0.0          │ │
│  │                            │  │ Size: 48 KB              │ │
│  │                            │  │ Checksum: sha256:9a8b…  │ │
│  │                            │  │ Tags: brand, template   │ │
│  │                            │  │ Created: 2026-07-15     │ │
│  │                            │  │ Created by: Nhân        │ │
│  │                            │  │                          │ │
│  │                            │  │ [Copy URI] [Download]    │ │
│  └────────────────────────────┘  └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

Files tab:
  ├── shell.docx          42 KB   [Download] [Preview]
  ├── colors.json          1 KB   [Download] [Preview]
  └── fonts.json           5 KB   [Download] [Preview]

Versions tab:
  ● 2.0.0 (current) — 2 days ago — "Updated colors per marketing v3"
  ○ 1.0.0             — 5 days ago — "Initial version"
  [Compare v1 ↔ v2]

References tab (reverse — ai / skill nào đang reference asset này):
  - skill: brand-docx v1.2.0
  - skill: press-release v0.3.0
  - session: ses_abc123 (3 days ago)

Permissions tab:
  Read: workspace members + org members
  Write: owner only
  [Edit permissions]
```

### 6.2. Composer integration (chat)

Trong chat composer, khi user gõ `/asset <name>` hoặc chọn asset từ menu → insert chip:

```
┌──────────────────────────────────────────────────────────────┐
│ User: Tạo báo cáo Q3 theo brand công ty, dùng logo mới nhất │
│                                                              │
│ 📎 acme/letterhead@2    📎 acme/hero-image@approved          │
│    [x] remove                [x] remove                     │
│                                                              │
│ [Send]                                                       │
└──────────────────────────────────────────────────────────────┘
```

Khi gửi, prompt sẽ được enrich với:

```
User: Tạo báo cáo Q3 theo brand công ty, dùng logo mới nhất

Attached assets:
- asset://workspace/acme/letterhead@2 (bundle, 2 files)
- asset://org/acme/hero-image@approved (file, png, 320 KB)

You can reference these via the asset:// URI scheme or call read_asset(id="...").
```

### 6.3. Files location

- `apps/app/src/react-app/domains/settings/pages/assets-view.tsx` — view chính
- `apps/app/src/react-app/domains/settings/panels/asset-detail-panel.tsx`
- `apps/app/src/react-app/domains/settings/modals/new-asset-dialog.tsx`
- `apps/app/src/react-app/domains/settings/modals/upload-asset-dialog.tsx`
- `apps/app/src/react-app/domains/settings/asset-state.ts` — query/mutation hooks
- `apps/app/src/react-app/domains/session/composer/asset-attachment.tsx` — chip trong composer
- `apps/app/src/lib/assets.ts` — detection helpers (mirror `apps/app/src/lib/artifacts.ts`)

### 6.4. Icons + i18n

- Icon: `Package` / `Archive` / `Layers` (lucide-react đã có trong stack)
- Shortcut: `⌘⌥5` mở Assets tab
- i18n keys: thêm vào `apps/app/src/react-app/infra/i18n/`

---

## 7. Agent & Skill referencing API

### 7.1. Engine tools (qua `openwork-extensions-preview.ts`)

Thêm 5 tool mới, song song với `openwork_extensions_export`:

```ts
// apps/server/src/opencode-plugins/openwork-extensions-preview.ts

tool({
  name: "list_assets",
  description: "List assets available to the current workspace, optionally filtered by scope/tag/mime.",
  parameters: z.object({
    scope: z.enum(["local", "workspace", "org", "hub"]).optional(),
    q: z.string().optional(),
    tag: z.string().optional(),
    mime: z.string().optional(),
    limit: z.number().max(100).default(20),
  }),
  execute: async (args, ctx) => { ... },
})

tool({
  name: "read_asset",
  description: "Read an asset by ID, optionally a specific version and file inside a bundle.",
  parameters: z.object({
    id: z.string(),                    // "acme/letterhead"
    scope: z.enum(["local", "workspace", "org", "hub"]).default("workspace"),
    version: z.string().optional(),
    file: z.string().optional(),       // for bundle
  }),
  execute: async (args, ctx) => { ... returns { manifest, content (base64 for binary / string for text), mime }> },
})

tool({
  name: "write_asset",
  description: "Create or update an asset in the current workspace (approval-gated).",
  parameters: z.object({
    id: z.string(),
    kind: z.enum(["file", "bundle", "text"]),
    content: z.union([z.string(), z.record(z.string())]),  // string for text/file, { path: content } for bundle
    mime: z.string().optional(),
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
    version: z.string().optional(),     // default: bump patch
  }),
  execute: async (args, ctx) => { ... },
})

tool({
  name: "resolve_asset",
  description: "Resolve one or more asset:// URIs to their concrete bytes/files.",
  parameters: z.object({
    references: z.array(z.string()),
  }),
  execute: async (args, ctx) => { ... },
})

tool({
  name: "search_assets",
  description: "Full-text search across asset manifests and (for text assets) content.",
  parameters: z.object({
    query: z.string(),
    scope: z.enum(["local", "workspace", "org", "hub"]).optional(),
  }),
  execute: async (args, ctx) => { ... },
})
```

### 7.2. Reference syntax trong prompt / skill

Trong skill, document hướng dẫn agent dùng:

```markdown
# Brand docx skill

Để tạo báo cáo theo brand công ty:

1. Resolve template:
   ```
   resolve_asset(["asset://workspace/acme/letterhead@2#shell.docx"])
   ```
2. Đọc metadata màu:
   ```
   read_asset(id="acme/letterhead", version="2", file="colors.json")
   ```
3. Generate → lưu output vào artifact.
```

### 7.3. Built-in skill `use-asset`

Tạo skill `.opencode/skills/use-asset/SKILL.md` (giống pattern `hub-skills`):

```markdown
---
name: use-asset
description: Resolve, read, write, and search assets in the current workspace.
---

# Use Asset

Khi bạn cần tham chiếu file/ảnh/template đã được team quản lý tập trung:

1. `list_assets` để xem asset có sẵn.
2. `resolve_asset` để lấy bytes (cũng cache local).
3. `read_asset` cho text/JSON.
4. Khi output, KHÔNG embed asset bytes vào response — chỉ tham chiếu `asset://` URI.

Xem `apps/server/src/assets.ts` để biết thêm chi tiết implementation.
```

### 7.4. Reverse reference index

Để trả lời "asset nào đang được dùng bởi skill/session nào", thêm bảng `asset_references` trong runtime store:

```
asset_references:
  - assetId: "workspace/acme/letterhead"
    referencedBy: [
      { kind: "skill", id: "brand-docx", version: "1.2.0" },
      { kind: "skill", id: "press-release", version: "0.3.0" },
      { kind: "session", id: "ses_abc123", at: "..." },
    ]
```

Index được build lazily: khi asset được đọc trong session / referenced trong skill prompt, ghi lại. UI "References" tab query bảng này.

---

## 8. Cloud sync (Den ↔ desktop)

### 8.1. Asset registry mới trên Den

Tương tự `marketplaces` / `providers`, thêm resource mới trong Den schema:

```
GET  /v1/orgs/:orgId/asset-registry
GET  /v1/orgs/:orgId/asset-registry/:scope/:ns/:name
GET  /v1/orgs/:orgId/asset-registry/:scope/:ns/:name/versions
POST /v1/orgs/:orgId/asset-registry/upload      # multipart, returns assetId
PATCH /v1/orgs/:orgId/asset-registry/:scope/:ns/:name
DELETE /v1/orgs/:orgId/asset-registry/:scope/:ns/:name
```

### 8.2. ResourceSnapshot

Thêm vào `apps/server/src/types.ts:1-25`:

```ts
type ResourceSnapshot = {
  // ...existing
  assets: AssetSnapshot[];
}

type AssetSnapshot = {
  id: string;
  scope: "org";
  name: string;
  kind: "file" | "bundle" | "text";
  version: string;
  tags: string[];
  manifestUrl: string;
  payloadUrl: string;
  sizeBytes: number;
  checksum: string;
  updatedAt: string;
}
```

### 8.3. desktop-cloud-sync

Trong `apps/server/src/desktop-cloud-sync.ts`, thêm:

```ts
diffAssets(local: InstalledAsset[], remote: AssetSnapshot[]): AssetSyncDiff[]

type AssetSyncDiff =
  | { kind: "install", asset: AssetSnapshot }
  | { kind: "sync", id: string, fromVersion: string, toVersion: string }
  | { kind: "uninstall", id: string }
  | { kind: "noop", id: string }
```

### 8.4. Hub

`hub-assets.ts` mirror `hub-skills.ts`:

```ts
const DEFAULT_HUB_REPO = "different-ai/openwork-assets@main"
type HubAsset = { id, scope, name, version, tags, manifestUrl, payloadUrl }
type HubCatalog = { assets: HubAsset[], updatedAt: string }

async function fetchHubCatalog(hub = DEFAULT_HUB_REPO): Promise<HubCatalog>
async function fetchHubAsset(hub, id, version): Promise<{ manifest, bytes }>
```

---

## 9. Security & Permissions

### 9.1. Read permission matrix

| Role / context | `local` | `workspace` | `org` | `hub` |
|---|---|---|---|---|
| Desktop user (same machine) | ✅ | ✅ (own workspace) | ✅ (if signed in to org) | ✅ |
| Remote desktop (different machine) | ❌ | ✅ (via API) | ✅ (if signed in) | ✅ |
| Agent trong workspace | ❌ (default off) | ✅ | ✅ | ✅ |
| Agent trong shared workspace | ❌ | ✅ | ✅ | ✅ |
| Skill | ❌ (unless explicitly granted) | ✅ | ✅ | ✅ |
| Public (share link) | n/a | opt-in per asset | opt-in per asset | n/a |

### 9.2. Write permission

- **local**: only owner of the local install
- **workspace**: workspace owners + admins (gated bởi `requireApproval`)
- **org**: org admins only (gated bởi Den auth)
- **hub**: PR-based flow (giống skill hub)

### 9.3. Approval flow

Mỗi `write_asset` / `update_asset` / `delete_asset` đều đi qua `requireApproval`:

1. Desktop user request → server queue approval event.
2. Hiện dialog trong UI: "Asset `acme/letterhead` sẽ được tạo phiên bản `2.1.0` (45 KB). Approve?"
3. User approve → write + `recordAudit` + `emitReloadEvent({ reason: "assets" })`.

Agent không bao giờ tự write asset — phải qua human approval.

### 9.4. Secret redaction

Mở rộng `extensions-export.ts:56-86`:

```ts
function redactAssetPayload(asset: ResolvedAsset): ResolvedAsset {
  if (asset.manifest.tags?.includes("secret")) {
    return { ...asset, content: "<redacted>", files: { ...mapValues(asset.files, () => "<redacted>") } }
  }
  return asset
}
```

Tag `secret` (case-insensitive) → toàn bộ payload bị redact khi export.

### 9.5. Blocked paths

`isBlockedWorkspaceFilePath` (`routes/files.ts:54-85`) đã chặn `.env*`, `.pem`, etc. Asset payload khi upload phải validate: nếu file nằm trong blocked list → reject 400.

### 9.6. Size & type limits

| Loại | Max size (default) | Configurable? |
|---|---|---|
| `text` | 1 MB | workspace setting |
| `file` (image, docx, etc.) | 50 MB | workspace setting |
| `bundle` | 200 MB total | workspace setting |
| Hub catalog fetch | 100 MB | server config |

Validate MIME khi upload bằng magic bytes, không chỉ extension.

### 9.7. Audit trail

```
asset_audit:
  - ts: 2026-07-18T10:00:00Z
    actor: user:abc123 | agent:ses_xyz
    action: upsert | read | delete | sync | install | uninstall
    assetId: workspace/acme/letterhead
    version: 2.0.0
    size: 48213
    checksum: sha256:9a8b…
    sessionId?: ses_xyz
    approvedBy?: user:abc123
```

Lưu vào `audit.ts` giống skill audit.

---

## 10. Rollout — milestones

### M0 — Spike (1 ngày, không merge)

- [ ] Spike `apps/server/src/assets.ts` skeleton + 1 endpoint test.
- [ ] Spike UI: tab "Assets" rỗng + route case.
- [ ] Confirm `ReloadReason` extension không phá reload loop.
- [ ] Confirm filesystem layout không xung đột với `.opencode/openwork/inbox|outbox`.

### M1 — Core server (3-4 ngày)

- [ ] Module `apps/server/src/assets.ts` với:
  - `listAssets(workspaceId, filter)`
  - `getAsset(workspaceId, scope, ns, name, version?)`
  - `getAssetVersions(workspaceId, scope, ns, name)`
  - `upsertAsset(workspaceId, scope, ns, name, manifest, payload)` (approval-gated)
  - `deleteAsset(workspaceId, scope, ns, name, version?)` (approval-gated)
  - `resolveAsset(workspaceId, refs[])`
  - `searchAssets(workspaceId, query)`
- [ ] `apps/server/src/validators.ts` + `apps/server/src/frontmatter.ts` helpers.
- [ ] Routes trong `apps/server/src/server.ts` (insert sau skills routes, ~line 2293).
- [ ] `ReloadReason = "assets"` + handler trong `reload-fingerprint.ts`.
- [ ] `audit.ts` integration.
- [ ] `routes/registry.ts` addRoute entries với `AuthMode = "client"`.
- [ ] Unit tests `apps/server/src/assets.test.ts` (mock fs).
- [ ] Integration test `apps/server/src/routes/assets.test.ts` (HTTP round-trip).

### M2 — UI library (3-4 ngày)

- [ ] `apps/app/src/app/types.ts:180-201` — thêm `"assets"` tab.
- [ ] `apps/app/src/react-app/domains/settings/shell/settings-page.tsx:62-103` — icon + label.
- [ ] `apps/app/src/react-app/domains/settings/shell/settings-route.tsx` — case.
- [ ] `apps/app/src/react-app/domains/settings/pages/assets-view.tsx` — list + filter.
- [ ] `apps/app/src/react-app/domains/settings/panels/asset-detail-panel.tsx` — preview / files / versions / permissions / references.
- [ ] `apps/app/src/react-app/domains/settings/modals/{new-asset,upload-asset,edit-asset}-dialog.tsx`.
- [ ] `apps/app/src/react-app/domains/settings/asset-state.ts` — query/mutation hooks.
- [ ] `apps/app/src/lib/assets.ts` — `AssetType`, `getAssetType`, `isAssetPreviewSupported`.
- [ ] Server REST client methods trong `apps/app/src/app/lib/openwork-server.ts`.
- [ ] i18n keys.
- [ ] Smoke test: upload 1 PNG, xuất hiện trong list, preview được, delete được.

### M3 — Agent tools + reference syntax (2-3 ngày)

- [ ] 5 tools trong `apps/server/src/opencode-plugins/openwork-extensions-preview.ts`:
  - `list_assets`, `read_asset`, `write_asset`, `resolve_asset`, `search_assets`
- [ ] Skill `.opencode/skills/use-asset/SKILL.md` hướng dẫn agent.
- [ ] Reverse reference index trong runtime store.
- [ ] Test: agent đọc asset, in URI trong response (không embed bytes).

### M4 — Composer integration (2 ngày)

- [ ] `apps/app/src/react-app/domains/session/composer/asset-attachment.tsx` — chip.
- [ ] Composer prompt enrich với attached assets list.
- [ ] `/asset` slash command + asset picker modal.
- [ ] Test: gửi message có attachment, agent nhận đúng URI.

### M5 — Cloud sync — Den side (3-4 ngày, parallel với M6)

- [ ] Den schema migration cho `asset-registry`.
- [ ] Den endpoints `GET/POST/PATCH/DELETE /v1/orgs/:orgId/asset-registry/*`.
- [ ] `ee/apps/den-api` + `ee/apps/den-controller` routes mới.
- [ ] Storage backend cho asset payload (S3-compatible hoặc Den internal blob).
- [ ] RBAC check `org_owner` / `org_admin` cho write endpoints.
- [ ] Den-side audit log.

### M6 — Cloud sync — Desktop side (2-3 ngày)

- [ ] `apps/server/src/types.ts` + `apps/server/src/desktop-cloud-sync.ts` mở rộng cho assets.
- [ ] `apps/app/src/app/lib/den.ts` + `apps/app/src/app/lib/den-types.ts` wire types + client methods.
- [ ] UI sync tab trong Settings → Cloud: "Assets" section với install/sync/uninstall actions.
- [ ] Test: tạo asset trên Den, sync xuống desktop, edit locally, sync lên.

### M7 — Hub (2-3 ngày)

- [ ] `apps/server/src/asset-hub.ts` mirror `skill-hub.ts`.
- [ ] Routes `/hub/assets`, `/workspace/:id/assets/hub/install`.
- [ ] UI: tab "Hub" trong asset library, list + filter + install.
- [ ] Repo `different-ai/openwork-assets` (public, GitHub raw) — không tạo trong PR này, follow-up.

### M8 — Polish & docs (2 ngày)

- [ ] Drag-drop upload, paste from clipboard, multi-file upload.
- [ ] Compare versions UI.
- [ ] Search full-text + tag autocomplete.
- [ ] Docs:
  - `packages/docs/start-here/manage-assets.mdx`
  - `packages/docs/start-here/share-assets.mdx`
  - `packages/docs/cloud/share-with-your-team/team-assets.mdx`
- [ ] Update `AGENTS.md` nếu convention thay đổi.
- [ ] CHANGELOG entry.
- [ ] ADR cho "Tại sao tách khỏi BrandKit" (link tới `brand-kit/`).

---

## 11. Test plan

### 11.1. Unit

- `assets.ts`: list / get / upsert / delete / resolve / search với mock fs.
- Validator: invalid manifest → throw, invalid URI → throw.
- Resolver: bundle file pointer `#path/to/file`.
- Semver loose match: `@2` → `2.0.0`.
- Redact: asset tagged `secret` → content = `<redacted>`.

### 11.2. Integration

- HTTP round-trip qua `apps/server`:
  - Upload bundle → list → get → resolve → delete.
  - Approval flow: write → 403 (no approval) → approve → 200.
  - Version bump: write same id lần 2 → version tăng, không overwrite.
- Cloud sync: simulate Den response, verify diff + apply.

### 11.3. E2E (Playwright + Electron CDP)

Drive UI trong Electron:
1. Mở Settings → Assets → empty state → "Upload asset" → chọn PNG → preview hiển thị → save.
2. Mở Composer → gõ `/asset` → chọn asset từ list → attach → gửi → agent response có URI reference.
3. Sync tab → install asset từ org → asset xuất hiện trong workspace scope.
4. Xoá asset → confirm dialog → audit log có entry.

Reference: dùng skill `fraimz` (`.opencode/skills/fraimz/`) cho frame proof.

### 11.4. Regression

- Đảm bảo Skills / MCP / Plugins / Commands / Artifacts / BrandKit / Inbox / Outbox không bị ảnh hưởng.
- Workspace export/import mở rộng cho assets nhưng không phá backward compat.
- `ReloadReason` mới không trigger reload loop.

---

## 12. Risks & open questions

### 12.1. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Scope overlap với BrandKit — user confused | M | Doc rõ: BrandKit là input, Asset Library là output. ADR. |
| R2 | Sync loop nếu Den thay đổi asset trong khi user đang edit local | M | `reload-fingerprint.ts` checksum + last-modified guard. |
| R3 | Bundle quá lớn → OOM khi resolve nhiều asset trong một prompt | M | Streaming API cho bundle; giới hạn mặc định 5 asset / prompt. |
| R4 | Agent lạm dụng `write_asset` để fill disk | M | Approval-gated + workspace setting cap on total asset storage. |
| R5 | Hub repo public → người lạ submit asset độc hại | L | PR review + checksum pinning + trust level cho hub. |
| R6 | Cloud sync bandwidth cost (asset payload lớn) | M | Lazy sync + chỉ sync khi user explicitly request. |
| R7 | Reverse reference index stale | L | Rebuild on reload; best-effort, không critical. |
| R8 | MIME spoofing (upload `.exe` rename `.png`) | M | Validate magic bytes; reject mismatch. |
| R9 | Pre-auth download URL leak | M | Short-lived signed URL, max 5 phút. |
| R10 | Local-only scope lộ asset khi share workspace | M | Default local scope = hidden từ shared workspace; opt-in. |

### 12.2. Open questions cần quyết định trước khi M1

1. **Storage layout** — versioned sub-folder (`2.0.0/`) hay flat với pointer file?
   → Recommend: versioned sub-folder + symlink `latest` trên POSIX, pointer file trên Windows.
2. **Reference URI scheme** — `asset://` hay OpenWork-specific scheme?
   → Recommend: `asset://` (theo IANA practice, dễ debug, giống `file://`).
3. **Versioning scheme** — strict semver hay label-based?
   → Recommend: cả hai. Asset manifest có `version: string` free-form, nhưng khi bump thì dùng semver nếu match pattern `MAJOR.MINOR.PATCH`.
4. **Text vs file vs bundle boundary** — khi nào text asset "trở thành" file asset?
   → Recommend: text = inline string < 1MB, file = single binary > 1MB, bundle = nhiều file. Threshold cấu hình được.
5. **Agent có được quyền `write_asset` không?**
   → Recommend MVP: chỉ qua approval flow. Post-MVP: scoped "agent-writable" flag per asset.
6. **Reverse reference** — build eagerly hay lazily?
   → Recommend: lazily. Chỉ build khi read, cleanup theo TTL.
7. **Hub repo `different-ai/openwork-assets` ownership?**
   → Follow-up, không block MVP.

### 12.3. Câu hỏi cần user confirm trước khi build

- [ ] Có muốn lưu asset vào `.opencode/assets/` (per-workspace, commit-able) hay chỉ global `~/.config/openwork/assets/`?
- [ ] Có cần scope `org` (cloud sync) trong MVP hay làm sau?
- [ ] Text asset có cần support versioning inline content không (vd. prompt template qua nhiều lần sửa)?
- [ ] Agent reference URI trong response — cho phép inline bytes hay chỉ URI?
  → Recommend chỉ URI (tiết kiệm token), có opt-in "include_bytes".
- [ ] Tên hiển thị: "Assets" hay "Library" hay "Templates"?
  → Recommend: "Assets" (neutral, cover cả brand kit, template, file).
- [ ] Shortcut đề xuất: `⌘⌥5` (sau Skills `⌘⌥2`, MCP `⌘⌥3`, Plugins `⌘⌥4`)?

---

## 13. Out of scope (để PRD khác)

- **Asset marketplace trên Den** — lớn hơn scope MVP, làm riêng.
- **Asset rendering cho tất cả MIME types** — MVP chỉ image / markdown / JSON / text. `.docx` qua converter `officecli_*` (đã có).
- **AI auto-tag asset** — feature riêng.
- **Asset analytics** (lượt dùng, hot asset) — telemetry, làm riêng.
- **Asset comment / discussion thread** — collaboration feature, làm riêng.
- **Replace BrandKit** — giữ BrandKit làm input, Asset Library làm quản lý output. Sau này có thể unify.

---

## 14. Tóm tắt

| Bề mặt | Hiện có | Sau MVP |
|---|---|---|
| File payload cho skill | Không | ✅ Asset Library |
| Reference ổn định từ prompt | Không | ✅ `asset://` URI |
| Versioning cho template | Không | ✅ semver + versions tab |
| Cloud sync cho file | Không (chỉ workspace) | ✅ Den asset-registry |
| Hub cho file giống skill hub | Không | ✅ `different-ai/openwork-assets` |
| Preview trong app | Chỉ HTML artifact | ✅ image / md / json / docx |
| Reverse reference (ai dùng asset nào) | Không | ✅ index trong runtime store |
| Permission model | Không | ✅ scope + role-based |

**Effort ước tính:** ~3-4 sprints (M1-M8) cho 1 dev full-time, parallel M5+M6 có thể rút ngắn.

**First milestone ngay sau khi duyệt plan:** M0 spike (1 ngày) để confirm filesystem layout và ReloadReason extension không phá hệ thống.
