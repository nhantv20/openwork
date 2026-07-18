import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, "..", "..", "..");
const OPENCODE_JSON = join(WORKSPACE_ROOT, ".opencode", "opencode.json");
const TOKENS_PATH = join(
  process.env.HOME || process.env.USERPROFILE || "/tmp",
  "Library/Application Support/com.differentai.openwork/openwork-server-tokens.json",
);

function findWorkspaceToken() {
  try {
    const raw = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
    const lower = WORKSPACE_ROOT.toLowerCase();
    for (const [path, data] of Object.entries(raw.workspaces || {})) {
      if (lower.includes(path.toLowerCase().replace(/\\/g, "/"))) {
        return data.ownerToken || data.clientToken;
      }
    }
    return raw.workspaces?.[""]?.ownerToken || null;
  } catch { return null; }
}

const TOKEN = findWorkspaceToken();
const OPENWORK_SERVER = process.env.OPENWORK_SERVER_URL || "http://127.0.0.1:57941";

async function fetchEngineMcpStatus() {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`${OPENWORK_SERVER}/opencode/mcp`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

function getMcpConfig() {
  try {
    const raw = JSON.parse(readFileSync(OPENCODE_JSON, "utf8"));
    return raw.mcp || {};
  } catch { return {}; }
}

async function getStatuses() {
  const mcpConfig = getMcpConfig();
  const engineStatuses = await fetchEngineMcpStatus();

  return Object.entries(mcpConfig).map(([name, cfg]) => {
    const type = String(cfg.type ?? "local");
    const cmd = cfg.command;
    const command = Array.isArray(cmd) ? cmd.join(" ") : String(cmd ?? "");
    const url = String(cfg.url ?? "");
    const enabled = cfg.enabled !== false;
    const endpoint = command || url || "—";
    const engineInfo = engineStatuses?.[name] ?? null;

    return {
      name,
      type,
      endpoint,
      source: "config.project",
      enabled,
      engineStatus: engineInfo?.status ?? null,
      engineError: engineInfo?.error ?? null,
      config: cfg,
    };
  });
}

const CSS = `:root {
  --bg: #0f172a; --bg-2: #1e293b;
  --panel: rgba(30,41,59,.7); --panel-2: rgba(30,41,59,.5);
  --hover: rgba(30,41,59,.9);
  --text: rgba(255,255,255,.92); --muted: rgba(255,255,255,.68); --muted-2: rgba(255,255,255,.5);
  --border: rgba(255,255,255,.12);
  --accent: #fbbf24; --accent-2: #f59e0b; --accent-3: #d97706;
  --accent-soft: rgba(251,191,36,.12); --accent-border: rgba(251,191,36,.3);
  --danger: #ff5b5b;
  --ok: #51d69c; --warn: #f0b34b;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; padding: 0; font-family: var(--sans); background: linear-gradient(135deg, var(--bg) 0%, var(--bg-2) 100%); color: var(--text); }
.wrap { max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }
a { color: var(--accent); }

/* === Header (giống Artifacts view) === */
.header { display: flex; align-items: center; gap: 10px; padding: 32px 16px 24px; border-bottom: 1px solid var(--border); margin-bottom: 24px; flex-wrap: wrap; }
.header h1 { margin: 0; font-size: 22px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
.header h1 .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgba(81,214,156,.15); color: var(--ok); border: 1px solid rgba(81,214,156,.3); }
.header .live { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.header .live .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); animation: pulse 2s infinite; }
.header .actions { margin-left: auto; display: flex; gap: 8px; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

/* === Summary cards === */
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.card .label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 6px; }
.card .value { font-size: 26px; font-weight: 600; }
.card .value.green { color: var(--ok); } .card .value.red { color: var(--danger); } .card .value.accent { color: var(--accent); } .card .value.warn { color: var(--warn); }

/* === Filter bar (giống Artifacts) === */
.filter-bar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.filter-bar input { background: rgba(255,255,255,.08); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; color: var(--text); font-size: 13px; width: 220px; outline: none; }
.filter-bar input:focus { border-color: var(--accent); }
.filter-bar input::placeholder { color: var(--muted-2); }
.filter-bar .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.filter-bar .tab { padding: 6px 14px; border-radius: 8px; font-size: 12px; border: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer; user-select: none; }
.filter-bar .tab.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 500; }
.filter-bar .tab:hover:not(.active) { background: rgba(255,255,255,.08); }
.filter-bar .count { font-size: 12px; color: var(--muted-2); white-space: nowrap; margin-left: auto; }

.btn { padding: 6px 14px; border-radius: 8px; font-size: 12px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.btn:hover { background: rgba(255,255,255,.08); }
.btn.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 500; }
.btn.primary:hover { background: #6dc4ff; }
.btn.icon { padding: 6px; }

/* === List rows (giống Artifacts: rounded card, hover group) === */
.list { display: grid; gap: 8px; }
.row { display: flex; align-items: center; gap: 16px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); transition: background 0.15s; cursor: pointer; }
.row:hover { background: var(--hover); }
.row .ico { display: flex; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 8px; background: rgba(83,184,255,.12); color: var(--accent); flex-shrink: 0; font-family: var(--mono); font-weight: 600; font-size: 14px; }
.row .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.row .name { font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px; }
.row .meta { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 12px; }
.row .endpoint-cell { font-family: var(--mono); font-size: 12px; color: var(--muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
.row:hover .actions { opacity: 1; }
.row .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent; color: var(--muted); cursor: pointer; transition: background 0.15s; }
.row .icon-btn:hover { background: rgba(255,255,255,.08); color: var(--text); }
.row .icon-btn.danger:hover { background: rgba(255,91,91,.12); color: var(--danger); }

.status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 500; }
.status-badge.connected { background: rgba(81,214,156,.12); color: var(--ok); border: 1px solid rgba(81,214,156,.25); }
.status-badge.failed { background: rgba(255,91,91,.12); color: var(--danger); border: 1px solid rgba(255,91,91,.25); }
.status-badge.idle { background: rgba(240,179,75,.12); color: var(--warn); border: 1px solid rgba(240,179,75,.25); }
.status-badge .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.status-badge.connected .dot { background: var(--ok); }
.status-badge.failed .dot { background: var(--danger); }
.status-badge.idle .dot { background: var(--warn); }
.type-tag { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: var(--mono); }
.type-tag.local { background: rgba(83,184,255,.12); color: var(--accent); }
.type-tag.remote { background: rgba(240,179,75,.12); color: var(--warn); }
.updated { text-align: right; font-size: 11px; color: var(--muted-2); margin-top: 8px; }
.empty-state { padding: 40px; text-align: center; color: var(--muted); font-size: 14px; border: 1px dashed var(--border); border-radius: 12px; }

/* === Detail overlay === */
.overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 100; align-items: center; justify-content: center; }
.overlay.open { display: flex; }
.panel { background: var(--bg-2); border: 1px solid var(--border); border-radius: 16px; width: 560px; max-width: 90vw; max-height: 80vh; overflow-y: auto; padding: 24px; }
.panel h2 { margin: 0 0 4px 0; font-size: 18px; }
.panel .psub { color: var(--muted); font-size: 12px; margin-bottom: 20px; }
.dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.dfield .dl { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 2px; }
.dfield .dv { font-size: 13px; font-family: var(--mono); word-break: break-all; }
.dtools .dth { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 8px; }`;

const HTML = `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCP Dashboard</title><style>/*CSS*/</style></head>
<body>
<div class="wrap" id="app">
  <div class="header">
    <h1>🧩 MCP Dashboard <span class="badge" id="countBadge">—</span></h1>
    <span class="live"><span class="pulse"></span> engine live</span>
    <div class="actions">
      <button class="btn" onclick="refresh()" title="Reload">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        Reload
      </button>
    </div>
  </div>

  <div class="summary" id="summary"></div>

  <div class="filter-bar">
    <input type="text" placeholder="Tìm MCP server..." id="search" oninput="render()">
    <div class="tabs">
      <span class="tab active" data-f="all" onclick="setF(this,'all')">All</span>
      <span class="tab" data-f="connected" onclick="setF(this,'connected')">Connected</span>
      <span class="tab" data-f="failed" onclick="setF(this,'failed')">Failed</span>
      <span class="tab" data-f="idle" onclick="setF(this,'idle')">Idle</span>
    </div>
    <span class="count" id="countText">0/0</span>
  </div>

  <div class="list" id="list"></div>
  <div class="updated" id="updated"></div>
</div>

<!-- detail overlay -->
<div class="overlay" id="overlay" onclick="if(event.target===this)closeD()">
  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div><h2 id="dName">—</h2><div class="psub" id="dSub">—</div></div>
      <button class="btn icon" onclick="closeD()" title="Đóng">✕</button>
    </div>
    <div class="dgrid">
      <div class="dfield"><div class="dl">Type</div><div class="dv" id="dType">—</div></div>
      <div class="dfield"><div class="dl">Status</div><div class="dv" id="dStatus">—</div></div>
      <div class="dfield" style="grid-column:1/-1"><div class="dl">Endpoint</div><div class="dv" id="dEndpoint">—</div></div>
      <div class="dfield"><div class="dl">Enabled</div><div class="dv" id="dEnabled">—</div></div>
      <div class="dfield"><div class="dl">Engine Status</div><div class="dv" id="dEngine">—</div></div>
    </div>
    <div class="dtools">
      <div class="dth" style="margin-top:16px">Error</div>
      <div id="dError" style="font-size:12px;word-break:break-all"></div>
    </div>
    <div class="dtools">
      <div class="dth" style="margin-top:16px">Config (copy for your MCP client)</div>
      <pre id="dConfigPre" style="background:rgba(255,255,255,.06);border-radius:8px;padding:12px;font-size:11px;line-height:1.6;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:0 0 8px 0"></pre>
      <button class="btn" onclick="copyConfig()">📋 Copy Config</button>
      <span id="dCopyResult" style="font-size:11px;color:var(--muted);margin-left:8px"></span>
    </div>
  </div>
</div>

<script>
let data = null, flt = 'all', poll = null;

async function fetchS() {
  try { const r = await fetch('/api'); return r.ok ? r.json() : null; }
  catch { return null; }
}

function sts(s) {
  if (s.engineStatus === 'connected') return 'connected';
  if (s.engineStatus) return 'idle';
  return 'idle';
}

function stl(s) {
  if (s.engineStatus === 'connected') return 'connected';
  if (s.engineStatus) return 'idle (on-demand)';
  return 'configured';
}

async function refresh() {
  const r = await fetchS();
  if (!r) { document.getElementById('countBadge').textContent = 'no engine'; return; }
  data = r;
  document.getElementById('countBadge').textContent = (r.statuses?.length || 0) + ' server(s)';
  render();
}

function render() {
  if (!data) return;
  const q = document.getElementById('search').value.toLowerCase();
  const all = (data.statuses||[]);
  const list = all.filter(s => {
    if (flt==='connected' && sts(s)!=='connected') return false;
    if (flt==='failed' && sts(s)!=='failed') return false;
    if (flt==='idle' && sts(s)!=='idle') return false;
    if (q && !s.name.toLowerCase().includes(q) && !s.endpoint.toLowerCase().includes(q)) return false;
    return true;
  });
  const total = all.length;
  const connected = all.filter(s => sts(s)==='connected').length;
  const failed = all.filter(s => sts(s)==='failed').length;
  const idle = total - connected - failed;
  document.getElementById('summary').innerHTML =
    '<div class="card"><div class="label">Total</div><div class="value accent">'+total+'</div></div>'+
    '<div class="card"><div class="label">Connected</div><div class="value green">'+connected+'</div></div>'+
    '<div class="card"><div class="label">Failed</div><div class="value '+(failed?'red':'')+'">'+failed+'</div></div>'+
    '<div class="card"><div class="label">Idle</div><div class="value warn">'+idle+'</div></div>';
  document.getElementById('countText').textContent = list.length + '/' + total;
  const listEl = document.getElementById('list');
  if (!list.length) {
    listEl.innerHTML = '<div class="empty-state">Không có MCP server nào khớp</div>';
  } else {
    listEl.innerHTML = list.map(s => {
      const o = sts(s);
      const initial = (s.name || '?')[0].toUpperCase();
      return '<div class="row" data-name="'+esc(s.name)+'" onclick="showD(this.dataset.name)">'+
        '<div class="ico">'+esc(initial)+'</div>'+
        '<div class="body">'+
          '<div class="name">'+
            '<span>'+esc(s.name)+'</span>'+
            '<span class="type-tag '+s.type+'">'+s.type+'</span>'+
            '<span class="status-badge '+o+'"><span class="dot"></span>'+stl(s)+'</span>'+
          '</div>'+
          '<div class="meta"><span class="endpoint-cell">'+esc(s.endpoint)+'</span></div>'+
        '</div>'+
        '<div class="actions">'+
          '<button class="icon-btn" onclick="event.stopPropagation();copyCmd(\\''+esc(s.name)+'\\')" title="Copy command">'+
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'+
          '</button>'+
          '<button class="icon-btn" onclick="event.stopPropagation();showD(\\''+esc(s.name)+'\\')" title="Xem chi tiết">'+
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'+
          '</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  document.getElementById('updated').textContent = 'Cập nhật ' + new Date().toLocaleTimeString();
}

function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

function setF(el, f) { document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); el.classList.add('active'); flt = f; render(); }

function showD(name) {
  const s = (data?.statuses||[]).find(x => x.name === name);
  if (!s) return;
  document.getElementById('dName').textContent = s.name;
  document.getElementById('dSub').textContent = 'source: ' + (s.source || '—');
  document.getElementById('dType').textContent = s.type === 'local' ? 'local (stdio)' : s.type === 'remote' ? 'remote (SSE)' : s.type;
  document.getElementById('dStatus').textContent = stl(s);
  document.getElementById('dStatus').style.color = s.engineStatus === 'connected' ? 'var(--ok)' : 'var(--warn)';
  document.getElementById('dEndpoint').textContent = s.endpoint;
  document.getElementById('dEnabled').textContent = String(s.enabled);
  const rawEngine = s.engineStatus || 'not synced';
  document.getElementById('dEngine').textContent = s.type === 'local' && rawEngine === 'failed' ? 'disconnected (expected — on-demand)' : rawEngine;
  const err = s.engineError || '';
  const el = document.getElementById('dError');
  if (err && !err.includes('Connection closed')) {
    el.textContent = err;
    el.style.color = 'var(--danger)';
  } else {
    el.textContent = '—';
    el.style.color = 'var(--muted)';
  }
  const config = document.getElementById('dConfigPre');
  config.textContent = JSON.stringify(s.config || { type: s.type, command: s.endpoint, enabled: s.enabled }, null, 2);
  document.getElementById('dCopyResult').textContent = '';
  document.getElementById('overlay').classList.add('open');
}

function closeD() { document.getElementById('overlay').classList.remove('open'); }

function copyConfig() {
  const text = document.getElementById('dConfigPre').textContent;
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById('dCopyResult').textContent = '✓ copied!';
    setTimeout(() => { document.getElementById('dCopyResult').textContent = ''; }, 1500);
  }).catch(() => {
    document.getElementById('dCopyResult').textContent = 'copy failed';
  });
}

function copyCmd(name) {
  const s = (data?.statuses||[]).find(x => x.name === name);
  if (!s) return;
  const text = s.endpoint || name;
  navigator.clipboard.writeText(text).then(() => {
    toast('✓ Copied: ' + text);
  });
}

function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;border:1px solid rgba(255,255,255,.2);padding:10px 20px;border-radius:8px;color:#fff;font-size:13px;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.4)';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

refresh();
if (poll) clearInterval(poll);
poll = setInterval(refresh, 5000);
</script></body></html>`;

const PORT = parseInt(process.env.MCP_DASHBOARD_PORT || process.env.PORT || "26320", 10);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api") {
    const statuses = await getStatuses();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ statuses, engineSync: null }));
    return;
  }

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(HTML.replace("/*CSS*/", CSS));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MCP Dashboard at http://127.0.0.1:${PORT}/dashboard`);
  console.log(`API at http://127.0.0.1:${PORT}/api`);
  console.log(`Config: ${OPENCODE_JSON}`);
  console.log(`Server: ${OPENWORK_SERVER}`);
  console.log(`Token: ${TOKEN ? "found" : "NOT FOUND"}`);
});
