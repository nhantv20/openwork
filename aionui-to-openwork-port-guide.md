# Huong dan Port AionUi vao OpenWork Fork

> Tai lieu nay huong dan cach port tung tinh nang cua AionUi (github.com/iOfficeAI/AionUi, branch main, v2.1.32) vao OpenWork fork cua anh (github.com/different-ai/openwork, branch dev). Moi giai doan co:
> - File path tham chieu trong AionUi (de doc code that)
> - File path can tao/sua trong OpenWork
> - Code mau cu the
> - Dependencies can them
> - Test case de verify

---

## Tong quan kien truc

**AionUi hien tai:**
```
packages/
├── desktop/         # Electron app
│   ├── src/renderer/  # React UI
│   ├── src/process/    # Electron main process
│   └── src/common/     # Shared types/adapters
├── web-host/         # Express + WS server
└── web-cli/          # Standalone CLI wrapper
```

**Renderer KHONG goi fs truc tiep** - tat ca di qua `ipcBridge` (packages/desktop/src/common/adapter/ipcBridge.ts), phan lon forward den aioncore (Rust backend) qua HTTP/WS.

**Mo hinh port sang OpenWork:**

OpenWork hien co:
- `apps/app/` - React UI (Vite)
- `apps/desktop/` - Electron shell
- `apps/server/` - Bun server (HTTP API)
- `.opencode/skills/` - skill system

AionUi can port gom 11 tinh nang (da liet ke truoc). File path tham chieu AionUi se duoc cite theo pattern: `aionui:<path>`.

---

## Giai doan 1: File Preview (1-2 tuan)

### Muc tieu
Preview moi loai file (PDF, Word, Excel, PPT, anh, code 30+ ngon ngu, diff) ngay trong app, co multi-tab.

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel.tsx` - container chinh
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewTabs.tsx` - multi-tab bar
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/viewers/PDFViewer.tsx` - PDF
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/viewers/ExcelViewer.tsx` - Excel
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/viewers/PptViewer.tsx` - PPT (dung `pptx2json`)
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/viewers/OfficeDocViewer.tsx` - Word (dung `mammoth`)
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/viewers/MarkdownViewer.tsx` - MD
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/viewers/ImageViewer.tsx` - anh
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/viewers/DiffViewer.tsx` - diff (dung `diff2html`)
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/context/PreviewContext.tsx` - state management
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/constants.ts` - constants
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/theme/codeEditorConfig.ts` - CodeMirror config
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/utils/fileIcon.ts` - file icon mapping

### File can sua trong OpenWork
- `apps/app/src/react-app/domains/session/artifacts/preview.tsx` - them cac viewer moi
- `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` - them nhanh render
- `apps/app/src/react-app/domains/session/artifacts/artifact-icon.tsx` - them icon
- `apps/app/src/lib/artifacts.ts` - them classification
- `apps/app/src/react-app/domains/session/artifacts/open-target.ts` - them extension
- `apps/app/package.json` - them dependencies

### Dependencies can them
```bash
cd apps/app
pnpm add mammoth @uiw/react-codemirror @uiw/codemirror-extensions-langs pptxgenjs xlsx-republish
pnpm add -D @types/mammoth
```

### Code mau

**1. Them cac viewer moi vao preview.tsx:**

```typescript
// apps/app/src/react-app/domains/session/artifacts/viewers/slides-preview.tsx
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

export function SlidesPreview({ url, title, className }: { url: string; title: string; className?: string }) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Goi OfficeCLI qua IPC de convert PPTX -> HTML
    window.electronAPI
      .invokeDesktop('officecli', 'view', url, 'html')
      .then((result: { html?: string; error?: string }) => {
        if (result.error) setError(result.error);
        else setHtml(result.html || '');
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [url]);

  if (loading) return <Loader2 className="animate-spin" />;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts"
      className={cn("w-full h-full border-0", className)}
      title={title}
    />
  );
}
```

```typescript
// apps/app/src/react-app/domains/session/artifacts/viewers/document-preview.tsx
import { useEffect, useState } from 'react';
import mammoth from 'mammoth';
import { Loader2 } from 'lucide-react';

export function DocumentPreview({ url, title, className }: { url: string; title: string; className?: string }) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => mammoth.convertToHtml({ arrayBuffer: buf }))
      .then(r => {
        // Wrap trong CSS dep
        setHtml(`
          <style>
            body { font-family: -apple-system, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; line-height: 1.6; }
            h1, h2, h3 { color: #1a1a1a; }
            table { border-collapse: collapse; width: 100%; }
            td, th { border: 1px solid #ccc; padding: 8px; }
          </style>
          ${r.value}
        `);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [url]);

  if (loading) return <Loader2 className="animate-spin" />;
  return <iframe srcDoc={html} sandbox="allow-same-origin" className={cn("w-full h-full border-0", className)} title={title} />;
}
```

**2. Them IPC handler trong Electron main:**

```javascript
// apps/desktop/electron/main.mjs - them handler
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

ipcMain.handle('officecli', async (event, action, ...args) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('officecli', [action, ...args, '--json'], {
      env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' }
    });
    let output = '';
    let errorOutput = '';
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => errorOutput += d.toString());
    proc.on('close', code => {
      if (code === 0) {
        try { resolve(JSON.parse(output)); }
        catch { resolve({ html: output }); }
      } else {
        reject(new Error(errorOutput || `OfficeCLI exited ${code}`));
      }
    });
  });
});
```

**3. Sua artifact-panel.tsx de render theo type:**

```typescript
// apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx
import { SlidesPreview } from './viewers/slides-preview';
import { DocumentPreview } from './viewers/document-preview';

// Trong switch render:
if (target.preview === 'slides') {
  return <SlidesPreview url={binaryObjectUrl || target.value} title={target.title} />;
}
if (target.preview === 'document') {
  return <DocumentPreview url={binaryObjectUrl || target.value} title={target.title} />;
}
```

**4. Cap nhat classification trong open-target.ts:**

```typescript
// Them vao extension mapping
const SLIDES_EXTENSIONS = new Set(['.ppt', '.pptx', '.pptm', '.pot', '.potx', '.odp']);
const DOCUMENT_EXTENSIONS = new Set(['.doc', '.docx', '.docm', '.odt', '.rtf', '.pages']);

// Trong classifyOpenTarget:
if (SLIDES_EXTENSIONS.has(ext)) return { ...target, preview: 'slides' };
if (DOCUMENT_EXTENSIONS.has(ext)) return { ...target, preview: 'document' };
```

**5. Them icon trong artifact-icon.tsx:**

```typescript
// Su dung lucide-react
import { Presentation, FileText } from 'lucide-react';

case 'slides': return <Presentation className="size-4" />;
case 'document': return <FileText className="size-4" />;
```

### Test case
1. Mo file .pptx trong workspace - phai render duoc slide, khong con "Preview unavailable"
2. Mo file .docx - phai render thanh HTML co format
3. Mo file .pdf - preview nhu cu
4. Mo nhieu file - multi-tab hoat dong, switch giua cac tab

---

## Giai doan 2: 21 Built-in Assistants (2-3 tuan)

### Muc tieu
Co san 21 assistants (PPT Creator, Word Creator, etc.) khong can setup.

### Phat hien quan trong
AionUi KHONG luu assistant definitions trong file .md nhu minh nghi. Chung duoc luu trong **aioncore (Rust)**, expose qua HTTP API. Frontend chi hien thi list.

**Moi assistant co 1 row trong DB voi fields:**
- `context` - system prompt
- `prompts` - suggested user prompts
- `enabled_skills` - skills duoc enable
- `models` - preferred models
- `prompts_i18n` / `context_i18n` - per-locale variants

### Tham chieu AionUi
- `aionui:packages/desktop/src/common/types/agent/assistantTypes.ts` - schema
- `aionui:packages/desktop/src/renderer/hooks/assistant/useAssistantList.ts` - list hook
- `aionui:packages/desktop/src/renderer/pages/settings/AssistantSettings/home/OfficialAssistantsGrid.tsx` - UI hien thi 21 assistants
- `aionui:packages/desktop/src/renderer/pages/settings/AssistantSettings/AssistantListPanel.tsx` - list panel
- `aionui:packages/desktop/src/process/utils/migrateAssistants.ts` - PRESET_ID_WHITELIST (danh sach 21 ID)

### Cach lam trong OpenWork

**Huong 1: Skill files trong .opencode/skills/ (de hon)**

Tao 21 skill files trong workspace, moi file la 1 assistant:

```
.opencode/skills/
├── pptx-creator/SKILL.md
├── word-creator/SKILL.md
├── excel-creator/SKILL.md
├── morph-ppt/SKILL.md
├── pitch-deck-creator/SKILL.md
├── dashboard-creator/SKILL.md
├── academic-paper/SKILL.md
├── financial-model-creator/SKILL.md
├── cowork/SKILL.md
├── game-3d/SKILL.md
├── ui-ux-pro-max/SKILL.md
├── planning-with-files/SKILL.md
├── human-3-coach/SKILL.md
├── social-job-publisher/SKILL.md
├── moltbook/SKILL.md
├── beautiful-mermaid/SKILL.md
├── openclaw-setup/SKILL.md
├── story-roleplay/SKILL.md
├── research-assistant/SKILL.md       ← bonus cho use case anh
├── doc-reader/SKILL.md              ← bonus
└── pdf-summarizer/SKILL.md         ← bonus
```

**Mau SKILL.md (pptx-creator):**

```markdown
---
name: pptx-creator
description: Tao presentation PPTX chuyen nghiep voi slide animation
triggers:
  - "tao slide"
  - "tao presentation"
  - "lam deck"
  - "tao pptx"
---

# PPT Creator

## Muc tieu
Tao file .pptx editable voi slide animation Morph chuyen nghiep.

## Quy trinh

1. **Phan tich yeu cau:**
   - Slide bao nhieu?
   - Theme mau gi?
   - Co can chart/anh khong?

2. **Su dung OfficeCLI de tao:**
```bash
# Tao file moi
officecli create deck.pptx

# Them slide
officecli add deck.pptx / --type slide --prop title="Q4 Report" --prop background="1A1A2E"

# Them shape/text
officecli add deck.pptx '/slide[1]' --type shape \
  --prop text="Revenue grew 25%" --prop x=2cm --prop y=5cm \
  --prop font="Arial" --prop size=24 --prop color="FFFFFF"
```

3. **Verify bang render:**
```bash
officecli view deck.pptx html -o /tmp/preview.html
```

4. **Output:** File .pptx nam trong workspace, ready de open trong app.

## Vi du su dung
User: "Tao slide gioi thieu cong ty"
- Tao file deck.pptx
- Them 5 slides: Cover, Mission, Team, Products, Contact
- Apply theme color thong nhat
- Render preview
```

**Skill cho use case research (bonus):**

```markdown
---
name: research-assistant
description: Doc va tong hop tai lieu, tao research notes co cite
triggers:
  - "research"
  - "tong hop tai lieu"
  - "doc va tom tat"
  - "synthesize"
---

# Research Assistant

## Quy trinh

1. **Doc file (PDF/DOCX/PPTX/MD):**
```bash
# Convert sang markdown
markitdown /path/to/document.pdf > /tmp/content.md
# Hoac dung read tool truc tiep
```

2. **Tom tat va trich xuat:**
   - Key insights
   - Important data points
   - Citations (file:line hoac page)

3. **Tao research note:**
```markdown
# Topic: [Ten topic]
Date: YYYY-MM-DD
Sources:
  - file1.pdf (pp. 1-10)
  - file2.docx

## Key Points
- ...

## Open Questions
- ...
```

4. **Luu vao workspace:** `research-notes/<topic>-YYYY-MM-DD.md`
```

**Huong 2: Backend API (giong AionUi hon)**

Them table `assistants` vao DB cua OpenWork:

```sql
CREATE TABLE assistants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  context TEXT NOT NULL,
  prompts TEXT,
  enabled_skills TEXT,
  models TEXT,
  source TEXT DEFAULT 'user',
  created_at INTEGER
);
```

Endpoint `GET /api/assistants` tra ve list. Frontend lay list qua SWR.

### File can sua
- `apps/server/src/routes/assistants.ts` (moi) - API endpoints
- `apps/app/src/react-app/hooks/useAssistantList.ts` (moi)
- `apps/app/src/react-app/pages/settings/Assistants/index.tsx` (moi) - UI
- Workspace: `.opencode/skills/` (theo huong 1)

### Test case
1. Trong chat, go "tao slide gioi thieu" - agent phai tao .pptx trong workspace
2. Mo file vua tao - preview render slide
3. Trong Settings, list 21 assistants
4. Click assistant -> chat context switch sang assistant do

---

## Giai doan 3: Scheduled Tasks (1-2 tuan)

### Muc tieu
Tao cron task chay 24/7, agent chay lap lich theo lich.

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx` - main page
- `aionui:packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx` - dialog tao task (HUGE 13KB, support manual/hourly/daily/weekdays/weekly/custom)
- `aionui:packages/desktop/src/renderer/pages/cron/cronUtils.ts` - cron utilities
- `aionui:packages/desktop/src/renderer/pages/cron/useCronJobs.ts` - hooks
- `aionui:packages/desktop/src/renderer/pages/cron/components/CronJobManager.tsx` - manager

### File can tao trong OpenWork
- `apps/server/src/routes/cron.ts` (moi) - API
- `apps/server/src/services/cron-runner.ts` (moi) - cron job runner
- `apps/app/src/react-app/pages/cron/index.tsx` (moi) - UI page
- `apps/app/src/react-app/hooks/useCronJobs.ts` (moi) - hooks
- DB migration: `cron_jobs` table

### Dependencies
```bash
cd apps/server
pnpm add croner
```

### Code mau

**1. DB schema:**

```sql
-- apps/server/src/db/migrations/2026_07_add_cron.sql
CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  schedule_kind TEXT NOT NULL,  -- 'cron' | 'every' | 'manual' | 'one-time'
  cron_expr TEXT,
  every_ms INTEGER,
  timezone TEXT DEFAULT 'UTC',
  one_time_at INTEGER,
  prompt TEXT NOT NULL,
  assistant_id TEXT,
  model_id TEXT,
  workspace_id TEXT,
  conversation_id TEXT,
  execution_mode TEXT DEFAULT 'new_conversation',  -- 'new_conversation' | 'existing'
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  next_run_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**2. Cron runner (Bun):**

```typescript
// apps/server/src/services/cron-runner.ts
import { Cron } from 'croner';
import { db } from '../db';

export class CronRunner {
  private jobs = new Map<string, Cron>();

  start() {
    // Load all enabled jobs from DB
    const jobs = db.query('SELECT * FROM cron_jobs WHERE enabled = 1').all();
    for (const job of jobs) {
      this.scheduleJob(job);
    }
  }

  scheduleJob(job: CronJob) {
    // Remove old
    this.jobs.get(job.id)?.stop();
    
    if (job.schedule_kind === 'manual') return;
    
    const options = job.timezone ? { timezone: job.timezone } : {};
    
    const trigger = new Cron(job.cron_expr || this.everyToCron(job.every_ms), options, async () => {
      await this.executeJob(job);
    });
    
    this.jobs.set(job.id, trigger);
    
    // Update next_run_at
    const next = trigger.nextRun();
    db.query('UPDATE cron_jobs SET next_run_at = ? WHERE id = ?').run(next?.getTime() || 0, job.id);
  }

  async executeJob(job: CronJob) {
    // Send prompt to agent
    await fetch(`${process.env.OPENWORK_URL}/api/conversations/${job.conversation_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.INTERNAL_TOKEN}` },
      body: JSON.stringify({ text: job.prompt, source: 'cron' })
    });
    
    db.query('UPDATE cron_jobs SET last_run_at = ? WHERE id = ?').run(Date.now(), job.id);
  }

  private everyToCron(everyMs: number): string {
    const minutes = Math.floor(everyMs / 60000);
    if (minutes < 60) return `*/${minutes} * * * *`;
    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`;
  }
}
```

**3. UI page:**

```typescript
// apps/app/src/react-app/pages/cron/index.tsx
import { useState } from 'react';
import { useCronJobs } from '../../hooks/useCronJobs';

export default function CronPage() {
  const { data: jobs, mutate } = useCronJobs();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Scheduled Tasks</h1>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary">
          + New Task
        </button>
      </div>
      
      <div className="space-y-2">
        {jobs?.map(job => (
          <CronJobRow key={job.id} job={job} onUpdate={mutate} />
        ))}
      </div>

      {showCreate && <CreateTaskDialog onClose={() => setShowCreate(false)} onCreated={mutate} />}
    </div>
  );
}
```

### Test case
1. Tao task "Moi sang 9h tom tat email" - cron 0 9 * * *
2. Verify next run time hien thi dung
3. Disable task - khong chay nua
4. Edit task - cap nhat dung
5. Khi chay, tao message moi trong conversation

---

## Giai doan 4: Remote Access (2-3 tuan)

### Muc tieu
Dieu khien agent tu Telegram, Lark/Feishu, hoac WebUI.

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/TelegramConfigForm.tsx`
- `aionui:packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/LarkConfigForm.tsx`
- `aionui:packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/ChannelHeader.tsx`
- `aionui:packages/web-host/src/index.ts` - WebUI server entry
- `aionui:scripts/webui.ts` - standalone WebUI launcher
- `aionui:packages/desktop/src/process/utils/webuiConfig.ts` - WebUI lifecycle
- `aionui:examples/ext-feishu/channels/ext-feishu-channel.js` - channel adapter example

### Kien truc
AionUi KHONG co Telegram/Lark code trong TypeScript. Chung la **channel adapters** trong aioncore. Frontend chi goi `ipcBridge.channel.*` chung.

### File can tao trong OpenWork
- `apps/server/src/channels/telegram.ts` (moi)
- `apps/server/src/channels/lark.ts` (moi)
- `apps/server/src/channels/dingtalk.ts` (moi)
- `apps/server/src/routes/webui.ts` (moi) - WebUI server
- `apps/app/src/react-app/pages/settings/Channels/index.tsx` (moi)
- `apps/desktop/electron/main.mjs` - them WebUI start/stop IPC

### Dependencies
```bash
cd apps/server
pnpm add grammy @larksuiteoapi/node-sdk dingtalk-stream qrcode qrcode.react
```

### Code mau

**1. Telegram bot:**

```typescript
// apps/server/src/channels/telegram.ts
import { Bot } from 'grammy';

export class TelegramChannel {
  private bot: Bot | null = null;
  private token: string;
  
  constructor(token: string) {
    this.token = token;
  }
  
  async start() {
    this.bot = new Bot(this.token);
    
    this.bot.on('message', async (ctx) => {
      const userId = ctx.from.id.toString();
      const text = ctx.message.text;
      
      // Forward den OpenWork agent
      const response = await fetch(`${process.env.OPENWORK_API}/api/chat`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENWORK_TOKEN}` 
        },
        body: JSON.stringify({ 
          user_id: `telegram:${userId}`, 
          text,
          channel: 'telegram'
        })
      });
      
      const result = await response.json();
      await ctx.reply(result.text || 'No response');
    });
    
    await this.bot.start();
  }
  
  async stop() {
    await this.bot?.stop();
  }
}
```

**2. WebUI server (Bun + QR):**

```typescript
// apps/server/src/routes/webui.ts
import { QRCode } from 'qrcode';

export async function startWebUI(port: number = 25808) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      
      if (url.pathname === '/qr') {
        // Generate QR cho mobile access
        const networkIP = getLocalIP();
        const mobileURL = `http://${networkIP}:${port}`;
        const qrSvg = await QRCode.toString(mobileURL, { type: 'svg' });
        return new Response(qrSvg, { headers: { 'Content-Type': 'image/svg+xml' } });
      }
      
      if (url.pathname === '/') {
        return new Response(getWebUIHTML(), { headers: { 'Content-Type': 'text/html' } });
      }
      
      // API proxy
      return proxyToOpenWorkAPI(req);
    }
  });
  
  return server;
}
```

### Test case
1. Cau hinh Telegram bot token
2. Gui message tu Telegram -> agent phan hoi
3. Mo WebUI tu browser khac -> co the chat voi agent
4. QR code hien thi IP local

---

## Giai doan 5: File Tree + Smart File Management (1-2 tuan)

### Muc tieu
Browse workspace, auto-organize files, batch rename.

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/index.tsx` - main panel
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/components/WorkspaceTabBar.tsx`
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/components/WorkspaceToolbar.tsx`
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/components/WorkspaceContextMenu.tsx`
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useWorkspaceTree.ts`
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useFileChanges.ts`
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useWorkspaceEvents.ts`
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/utils/fileIcon.ts`

### File can tao trong OpenWork
- `apps/app/src/react-app/domains/workspace/file-tree/index.tsx` (moi)
- `apps/app/src/react-app/domains/workspace/file-tree/file-tree-node.tsx` (moi)
- `apps/server/src/routes/files.ts` - them list endpoint
- `apps/app/src/app/lib/openwork-server.ts` - them method

### Dependencies
```bash
cd apps/app
pnpm add @tanstack/react-virtual
```

### Code mau

**1. File tree component:**

```typescript
// apps/app/src/react-app/domains/workspace/file-tree/index.tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/app/lib/openwork-server';
import { useRef } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder } from 'lucide-react';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

export function FileTree({ workspaceId, onFileClick }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const { data: tree } = useQuery({
    queryKey: ['file-tree', workspaceId],
    queryFn: () => client.listWorkspaceDirectory(workspaceId, '/')
  });
  
  const flatItems = flattenTree(tree || []);
  
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 20
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto p-2">
      {virtualizer.getVirtualItems().map(virtualRow => {
        const item = flatItems[virtualRow.index];
        return (
          <FileTreeNode
            key={item.path}
            node={item}
            depth={item.depth}
            onClick={() => item.type === 'file' && onFileClick(item)}
          />
        );
      })}
    </div>
  );
}
```

**2. Server endpoint:**

```typescript
// apps/server/src/routes/files.ts - them endpoint
.get('/workspace/:id/files/list', async (c) => {
  const workspaceId = c.req.param('id');
  const path = c.req.query('path') || '/';
  
  const entries = await fs.readdir(workspacePath(workspaceId, path), { withFileTypes: true });
  
  return c.json(entries.map(entry => ({
    name: entry.name,
    path: join(path, entry.name),
    type: entry.isDirectory() ? 'directory' : 'file',
    size: entry.isFile() ? entry.size : undefined
  })));
})
```

**3. Smart file management qua skill:**

```markdown
# .opencode/skills/file-organizer/SKILL.md

## Quy trinh

1. Scan folder target
2. Phan loai file theo:
   - Extension (.pdf, .docx, .md, ...)
   - Date modified
   - Content (dung agent doc)
3. Tao subfolder neu can
4. Move files

## Vi du
User: "Sap xep folder Downloads"
- Scan ~/Downloads
- Group: PDFs, Docs, Images, Videos, Others
- Tao folders tuong ung
- Move files
```

### Test case
1. Mo workspace - thay cay folder
2. Click folder - mo cac file con (lazy load)
3. Click file - mo preview
4. Right-click - co menu rename, delete, move
5. Goi agent "sap xep Downloads" - tu dong organize

---

## Giai doan 6: Git Version History (1 tuan)

### Muc tieu
Track file changes, rollback 1-click.

### Phat hien quan trong
AionUi KHONG dung Git library (isomorphic-git, simple-git). Ho dung **2 co che**:

1. **Per-file snapshots** - luu content theo thoi gian
2. **Workspace-level Changes** - custom diff tracker (init/compare)

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/hooks/usePreviewHistory.ts` - file history
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewHistoryDropdown.tsx` - UI dropdown
- `aionui:packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useFileChanges.ts` - workspace changes
- `aionui:packages/desktop/src/renderer/pages/conversation/Preview/components/viewers/DiffViewer.tsx` - diff render

### File can tao trong OpenWork
- `apps/server/src/routes/history.ts` (moi) - snapshot API
- `apps/app/src/react-app/domains/workspace/history/index.tsx` (moi) - history UI
- `apps/server/src/db/migrations/2026_07_add_history.sql` - snapshots table

### Code mau

**1. Schema:**

```sql
CREATE TABLE file_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content TEXT,
  created_at INTEGER NOT NULL,
  trigger TEXT  -- 'auto' | 'manual' | 'before-edit'
);

CREATE INDEX idx_snapshots_workspace_file ON file_snapshots(workspace_id, file_path, created_at DESC);
```

**2. Auto-snapshot on save:**

```typescript
// apps/server/src/middleware/auto-snapshot.ts
import { db } from '../db';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';

export async function snapshotBeforeWrite(workspaceId: string, filePath: string) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    
    db.query(`
      INSERT INTO file_snapshots (id, workspace_id, file_path, content_hash, content, created_at, trigger)
      VALUES (?, ?, ?, ?, ?, ?, 'auto')
    `).run(crypto.randomUUID(), workspaceId, filePath, hash, content, Date.now());
  } catch {
    // File moi, khong co snapshot truoc
  }
}
```

**3. History UI:**

```typescript
// apps/app/src/react-app/domains/workspace/history/index.tsx
import { useQuery } from '@tanstack/react-query';

export function FileHistory({ workspaceId, filePath, onRestore }: Props) {
  const { data: history } = useQuery({
    queryKey: ['file-history', workspaceId, filePath],
    queryFn: () => client.getFileHistory(workspaceId, filePath)
  });

  return (
    <div className="border rounded p-2">
      <h3 className="text-sm font-semibold mb-2">Version History</h3>
      {history?.map(snap => (
        <div key={snap.id} className="flex justify-between items-center py-1">
          <div>
            <div className="text-sm">{new Date(snap.created_at).toLocaleString()}</div>
            <div className="text-xs text-gray-500">{snap.trigger}</div>
          </div>
          <button 
            onClick={() => onRestore(snap)}
            className="btn btn-sm"
          >
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}
```

### Test case
1. Sua file nhieu lan - moi lan tao snapshot
2. Mo history - thay danh sach versions
3. Click Restore - file quay ve version cu
4. Diff giua 2 version - hien thi thay doi

---

## Giai doan 7: Multi-tab Sessions (1 tuan)

### Muc tieu
Mo nhieu conversation song song, switch nhanh.

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx` - sidebar chinh
- `aionui:packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx`
- `aionui:packages/desktop/src/renderer/pages/conversation/GroupedHistory/SortableConversationRow.tsx`
- `aionui:packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useDragAndDrop.ts`
- `aionui:packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useBatchSelection.ts`

### File can sua trong OpenWork
- `apps/app/src/react-app/domains/session/sidebar/conversation-row.tsx` - cai thien
- `apps/app/src/react-app/domains/session/sidebar/tab-strip.tsx` (moi) - tab ngang
- Them drag-drop voi `@dnd-kit/sortable`

### Dependencies
```bash
cd apps/app
pnpm add @dnd-kit/sortable @dnd-kit/core
```

### Code mau

```typescript
// apps/app/src/react-app/domains/session/sidebar/tab-strip.tsx
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';

export function ConversationTabStrip() {
  const { conversations, activeId, switchTo, reorder } = useConversations();

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={reorder}>
      <SortableContext items={conversations} strategy={horizontalListSortingStrategy}>
        <div className="flex overflow-x-auto border-b">
          {conversations.map(conv => (
            <SortableTab
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeId}
              onClick={() => switchTo(conv.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
```

### Test case
1. Mo 3 conversation - thay 3 tab
2. Drag tab de sap xep
3. Click tab - switch nhanh
4. Pin conversation quan trong

---

## Giai doan 8: Multi-Agent Team Mode (2-3 tuan)

### Muc tieu
Phoi hop nhieu agent cung luc, leader dieu phoi teammates.

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/pages/team/TeamPage.tsx`
- `aionui:packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx`
- `aionui:packages/desktop/src/renderer/pages/team/hooks/useTeamSession.ts`
- `aionui:packages/desktop/src/renderer/pages/team/hooks/useTeamRunView.ts`
- `aionui:packages/desktop/src/renderer/pages/team/identity/teamMemberColors.ts`
- `aionui:packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx` - ACP integration
- `aionui:packages/desktop/src/common/types/team/teamTypes.ts` - team schema

### AionUi dung gi
- **ACP (Agent Communication Protocol)** tu Agent Client Protocol project
- Library: `@agentclientprotocol/sdk: ^0.18.2`
- Moi agent backend (Claude Code, Codex, etc.) la "ACP-compatible"

### File can tao trong OpenWork
- `apps/app/src/react-app/domains/team/team-page.tsx` (moi)
- `apps/app/src/react-app/domains/team/team-chat-view.tsx` (moi)
- `apps/app/src/react-app/domains/team/hooks/useTeamSession.ts` (moi)
- `apps/server/src/routes/teams.ts` (moi) - API
- DB migration: `teams`, `team_members`, `mailbox` tables

### Dependencies
```bash
cd apps/server
pnpm add @agentclientprotocol/sdk
```

### Code mau

**1. Team schema:**

```sql
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  workspace TEXT,
  workspace_mode TEXT DEFAULT 'shared',
  created_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL,
  role TEXT DEFAULT 'teammate',  -- 'leader' | 'teammate'
  slot_id TEXT,
  conversation_id TEXT,
  model_id TEXT,
  created_at INTEGER,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE TABLE mailbox (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  to_member_id TEXT,
  from_member_id TEXT,
  type TEXT DEFAULT 'message',
  content TEXT,
  summary TEXT,
  read INTEGER DEFAULT 0,
  created_at INTEGER,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);
```

**2. Team page:**

```typescript
// apps/app/src/react-app/domains/team/team-page.tsx
import { useTeamSession, useTeamRunView } from './hooks';

export default function TeamPage({ teamId }: { teamId: string }) {
  const { team, members } = useTeamSession(teamId);
  const { runState, slotWork } = useTeamRunView(teamId);

  return (
    <div className="grid grid-cols-[300px_1fr] h-full">
      <div className="border-r p-4">
        <h2 className="font-bold mb-4">{team?.name}</h2>
        <div className="space-y-2">
          {members.map(member => (
            <TeamMemberCard 
              key={member.id} 
              member={member} 
              state={slotWork.find(s => s.slot_id === member.slot_id)}
            />
          ))}
        </div>
      </div>
      
      <div className="p-4">
        <TeamChatView teamId={teamId} />
      </div>
    </div>
  );
}
```

### Test case
1. Tao team voi 1 leader + 2 teammates
2. Gui message - leader phan tich va delegate
3. Teammates chay song song, hien thi trong slot
4. Leader tong hop ket qua

---

## Giai doan 9: MCP Unified Management (1 tuan)

### Muc tieu
Config MCP 1 lan, ap dung cho moi agent.

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/pages/settings/ToolsSettings/index.tsx`
- `aionui:packages/desktop/src/renderer/pages/settings/ToolsSettings/McpManagement.tsx`
- `aionui:packages/desktop/src/renderer/hooks/mcp/useMcpServers.ts`
- `aionui:packages/desktop/src/renderer/hooks/mcp/useMcpServerCRUD.ts`
- `aionui:packages/desktop/src/renderer/hooks/mcp/useMcpOAuth.ts`
- `aionui:packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts` - built-in MCP
- `aionui:packages/desktop/src/common/config/storage.ts` - IMcpServer type

### File can tao trong OpenWork
- `apps/server/src/routes/mcp.ts` (moi)
- `apps/app/src/react-app/pages/settings/ToolsSettings/index.tsx` (moi)
- DB migration: `mcp_servers` table

### Code mau

**1. Schema:**

```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,  -- 'stdio' | 'sse' | 'http'
  command TEXT,  -- for stdio
  args TEXT,  -- JSON array
  env TEXT,  -- JSON object
  url TEXT,  -- for sse/http
  enabled INTEGER DEFAULT 1,
  oauth_config TEXT,  -- JSON
  created_at INTEGER
);
```

**2. API endpoints:**

```typescript
// apps/server/src/routes/mcp.ts
.get('/mcp/servers', async (c) => {
  const servers = db.query('SELECT * FROM mcp_servers WHERE user_id = ?').all(c.get('userId'));
  return c.json(servers);
})
.post('/mcp/servers', async (c) => {
  const body = await c.req.json();
  const id = crypto.randomUUID();
  db.query(`
    INSERT INTO mcp_servers (id, user_id, name, transport, command, args, env, url, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, c.get('userId'), body.name, body.transport, body.command,
         JSON.stringify(body.args || []), JSON.stringify(body.env || {}),
         body.url, Date.now());
  return c.json({ id });
})
.post('/mcp/servers/:id/test', async (c) => {
  const id = c.req.param('id');
  const server = db.query('SELECT * FROM mcp_servers WHERE id = ?').get(id);
  const result = await testMcpConnection(server);
  return c.json(result);
})
```

**3. Built-in MCP (Image gen):**

```typescript
// apps/server/src/builtin-mcp/image-gen.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({ name: 'aionui-image-gen', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler('tools/list', async () => ({
  tools: [{
    name: 'aionui_image_generation',
    description: 'Generate images from text prompt',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        image_uris: { type: 'array', items: { type: 'string' } }
      },
      required: ['prompt']
    }
  }]
}));

server.setRequestHandler('tools/call', async (request) => {
  // Call image gen API
  // ...
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Test case
1. Them MCP server Notion
2. Test connection - thanh cong
3. Agent su dung tool tu MCP
4. Disable MCP - tool bien mat

---

## Giai doan 10: Custom CSS Theming (3 ngay)

### Muc tieu
User custom giao dien qua CSS.

### Tham chieu AionUi
- `aionui:packages/desktop/src/renderer/pages/settings/AppearanceSettings/CssThemeSettings.tsx`
- `aionui:packages/desktop/src/renderer/pages/settings/AppearanceSettings/CssThemeModal.tsx`
- `aionui:packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets/default.css` - theme mau
- `aionui:packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets.ts` - BUILTIN_THEMES

### File can tao trong OpenWork
- `apps/app/src/react-app/pages/settings/Appearance/CustomCss.tsx` (moi)
- `apps/app/src/app/theme/custom-css-injector.ts` (moi)

### Code mau

```typescript
// apps/app/src/app/theme/custom-css-injector.ts
export function injectCustomCSS(css: string) {
  // Remove old
  const old = document.getElementById('custom-theme-css');
  old?.remove();
  
  if (!css.trim()) return;
  
  // Inject new
  const style = document.createElement('style');
  style.id = 'custom-theme-css';
  style.textContent = css;
  document.head.appendChild(style);
}
```

```typescript
// apps/app/src/react-app/pages/settings/Appearance/CustomCss.tsx
import { useState } from 'react';
import { useCustomCSS } from '@/hooks/useCustomCSS';

export function CustomCssSettings() {
  const { css, setCss } = useCustomCSS();
  const [preview, setPreview] = useState(css);

  return (
    <div className="grid grid-cols-2 gap-4 p-6">
      <div>
        <h3 className="font-bold mb-2">CSS Editor</h3>
        <textarea
          className="w-full h-96 font-mono text-sm p-2 border rounded"
          value={preview}
          onChange={e => setPreview(e.target.value)}
        />
        <button 
          onClick={() => setCss(preview)}
          className="btn btn-primary mt-2"
        >
          Apply
        </button>
      </div>
      <div>
        <h3 className="font-bold mb-2">Preview</h3>
        <iframe srcDoc={`<style>${preview}</style><div class="app">...</div>`} />
      </div>
    </div>
  );
}
```

### Test case
1. Vao Settings > Appearance > Custom CSS
2. Nhap CSS tuy y
3. Click Apply - giao dien thay doi
4. Reset - ve mac dinh

---

## Giai doan 11: Image Generation (1 tuan)

### Muc tieu
Tao anh tu prompt ngay trong app.

### Tham chieu AionUi
- `aionui:packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts` - MCP server
- `aionui:packages/desktop/src/common/chat/imageGenCore.ts` - core logic
- `aionui:packages/desktop/src/common/config/imageGenerationMcpEnv.ts` - env config

### Cach lam trong OpenWork

**Huong 1: Qua MCP server (giong AionUi)**

Tao built-in MCP server cho image gen, agent goi qua MCP.

**Huong 2: Qua skill**

Tao skill `.opencode/skills/image-gen/SKILL.md`:

```markdown
# Image Generation

## Providers
- OpenAI DALL-E
- Google Imagen
- Stability AI
- Local Stable Diffusion

## Quy trinh

1. User go "tao anh..."
2. Goi API provider
3. Save image vao workspace
4. Render trong chat
```

### Code mau (skill implementation)

```typescript
// .opencode/skills/image-gen/image-gen.ts
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';

export async function generateImage(prompt: string, outputDir: string) {
  const client = new OpenAI();
  
  const response = await client.images.generate({
    model: 'dall-e-3',
    prompt,
    size: '1024x1024',
    n: 1,
  });
  
  const url = response.data[0].url!;
  const imageResponse = await fetch(url);
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  
  const filename = `image-${Date.now()}.png`;
  const outputPath = path.join(outputDir, filename);
  await fs.writeFile(outputPath, buffer);
  
  return outputPath;
}
```

### Test case
1. Trong chat: "Tao anh mot con meo viet"
2. Image xuat hien trong chat
3. File .png luu trong workspace
4. Preview render anh

---

## Tong hop timeline

| Giai doan | Tinh nang | Thoi gian | Do kho |
|---|---|---|---|
| 1 | File Preview (PPT/Word/PDF/Excel/anh/code) | 1-2 tuan | Trung binh |
| 2 | 21 Built-in Assistants (skills) | 2-3 tuan | Trung binh |
| 3 | Scheduled Tasks (cron) | 1-2 tuan | Trung binh |
| 4 | Remote Access (Telegram/Lark/WebUI) | 2-3 tuan | Kho |
| 5 | File Tree + Smart File Management | 1-2 tuan | Trung binh |
| 6 | Git Version History + Rollback | 1 tuan | Trung binh |
| 7 | Multi-tab Sessions UI | 1 tuan | De |
| 8 | Multi-Agent Team Mode | 2-3 tuan | Kho |
| 9 | MCP Unified Management | 1 tuan | Trung binh |
| 10 | Custom CSS Theming | 3 ngay | De |
| 11 | Image Generation | 1 tuan | De |
| **Tong** | | **14-22 tuan** | |

---

## Khuyen nghi thuc te cho anh

Anh focus vao **doc tai lieu + research**. Toi se uu tien:

**Quan trong nhat (2-3 tuan):**
- Giai doan 1 (File Preview) - xem PDF/DOCX/PPT ngay trong app
- Giai doan 2 (Skills cho research) - 5-10 skill files cho workflow research

**Quan trong (3-4 tuan):**
- Giai doan 5 (File Tree) - browse workspace
- Giai doan 6 (Version History) - track note qua thoi gian

**Neu con thoi gian (5-10 tuan):**
- Giai doan 3 (Scheduled Tasks) - research dinh ky
- Giai doan 7 (Multi-tab Sessions) - parallel research

**Co the bo qua neu khong can:**
- Giai doan 4 (Remote) - phuc tap, it can thiet
- Giai doan 8 (Team Mode) - chi can neu muon multi-agent

**Tong cong: 5-7 tuan de co OpenWork fork voi cac tinh nang research-focused.**

Anh muon toi bat dau huong dan chi tiet giai doan nao truoc?