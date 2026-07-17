import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, "..", "..", "..");
const OPENCODE_JSON = join(WORKSPACE_ROOT, ".opencode", "opencode.json");

// Engine auth
const ENGINE_URL = "http://127.0.0.1:57899";
const ENGINE_USER = "0767fd8b733a4eaf98e32a24ff7c410fb9615a0f32064b87ad93233603e75bad";
const ENGINE_PASS = "6fec089e316c44e5bc26006bcfee5ef4c11efb1aa23e4d79acbc0b1c62e5a053";

async function getMcpConfigFromFile() {
  try {
    const raw = await readFile(OPENCODE_JSON, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.mcp || {};
  } catch {
    return {};
  }
}

async function fetchEngineMcpStatus() {
  const auth = Buffer.from(`${ENGINE_USER}:${ENGINE_PASS}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    "x-opencode-directory": WORKSPACE_ROOT,
  };
  try {
    const res = await fetch(`${ENGINE_URL}/mcp`, { headers, signal: AbortSignal.timeout(5000) });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

function checkProcessRunning(command) {
  const first = Array.isArray(command) ? command[0] : command.trim().split(/\s+/)[0];
  const name = first.replace(/^.*[/\\]/, "").replace(/\.(exe|cmd|ps1)$/i, "");
  if (!name) return null;
  try {
    execSync(`Get-Process -Name "${name}" -ErrorAction SilentlyContinue`, { stdio: "pipe", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function checkRemoteReachable(url) {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function getStatuses() {
  const mcpConfig = await getMcpConfigFromFile();
  const engineStatuses = await fetchEngineMcpStatus();
  const statuses = [];

  for (const [name, cfg] of Object.entries(mcpConfig)) {
    const type = String(cfg.type ?? "local");
    const command = Array.isArray(cfg.command) ? cfg.command.join(" ") : String(cfg.command ?? "");
    const url = String(cfg.url ?? "");
    const enabled = cfg.enabled !== false;
    const endpoint = command || url || "—";
    const engineInfo = engineStatuses?.[name] ?? null;

    let processRunning = null;
    let reachable = null;
    let error = null;

    if (type === "local" && command) {
      try {
        processRunning = checkProcessRunning(command);
        if (processRunning === false) error = "Process not found";
      } catch (e) {
        processRunning = false;
        error = String(e);
      }
    } else if (type === "remote" && url) {
      reachable = await checkRemoteReachable(url);
      if (!reachable) error = "URL not reachable";
    }

    const rawConfig = Object.fromEntries(
      Object.entries(cfg).filter(([k]) => !k.startsWith("_"))
    );

    statuses.push({
      name,
      type,
      endpoint,
      source: "config.project",
      enabled,
      engineStatus: engineInfo?.status ?? null,
      engineToolCount: null,
      processRunning,
      reachable,
      error,
      config: rawConfig,
    });
  }

  return statuses;
}

const CSS = `:root {
  --bg: #0b1020;
  --panel: rgba(255,255,255,.06);
  --panel-2: rgba(255,255,255,.04);
  --text: rgba(255,255,255,.92);
  --muted: rgba(255,255,255,.68);
  --muted-2: rgba(255,255,255,.5);
  --border: rgba(255,255,255,.12);
  --accent: #53b8ff;
  --danger: #ff5b5b;
  --ok: #51d69c;
  --warn: #f0b34b;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; padding: 0; font-family: var(--sans); background: radial-gradient(1200px 900px at 20% 10%, rgba(83,184,255,.14), transparent 60%), radial-gradient(900px 700px at 80% 0%, rgba(81,214,156,.1), transparent 55%), linear-gradient(180deg, #080b16, var(--bg)); color: var(--text); }
.wrap { max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }
a { color: var(--accent); }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 8px; }
.header h1 { margin: 0; font-size: 20px; display: flex; align-items: center; gap: 10px; }
.header h1 .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgba(81,214,156,.15); color: var(--ok); border: 1px solid rgba(81,214,156,.3); }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
.card { background: linear-gradient(180deg, var(--panel), var(--panel-2)); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.card .label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 6px; }
.card .value { font-size: 26px; font-weight: 600; }
.card .sub { font-size: 11px; color: var(--muted); margin-top: 4px; }
.card .value.green { color: var(--ok); }
.card .value.red { color: var(--danger); }
.card .value.accent { color: var(--accent); }
.card .value.warn { color: var(--warn); }
.filter-bar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.filter-bar input { background: rgba(255,255,255,.08); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; color: var(--text); font-size: 13px; width: 200px; outline: none; }
.filter-bar input:focus { border-color: var(--accent); }
.filter-bar input::placeholder { color: var(--muted-2); }
.filter-bar .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.filter-bar .tab { padding: 6px 14px; border-radius: 8px; font-size: 12px; border: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer; user-select: none; }
.filter-bar .tab.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 500; }
.filter-bar .tab:hover:not(.active) { background: rgba(255,255,255,.08); }
.filter-bar .actions { margin-left: auto; display: flex; gap: 8px; }
.btn { padding: 6px 14px; border-radius: 8px; font-size: 12px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; }
.btn:hover { background: rgba(255,255,255,.08); }
.btn.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 500; }
.table-wrap { background: linear-gradient(180deg, var(--panel), var(--panel-2)); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
thead th { text-align: left; padding: 10px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 500; }
tbody tr { border-bottom: 1px solid rgba(255,255,255,.05); }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: rgba(255,255,255,.04); }
tbody tr.disabled { opacity: .45; }
tbody td { padding: 12px 14px; font-size: 13px; vertical-align: middle; }
.status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 500; }
.status-badge.running { background: rgba(81,214,156,.12); color: var(--ok); border: 1px solid rgba(81,214,156,.25); }
.status-badge.stopped { background: rgba(255,91,91,.12); color: var(--danger); border: 1px solid rgba(255,91,91,.25); }
.status-badge.pending { background: rgba(240,179,75,.12); color: var(--warn); border: 1px solid rgba(240,179,75,.25); }
.status-badge .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.status-badge.running .dot { background: var(--ok); }
.status-badge.stopped .dot { background: var(--danger); }
.status-badge.pending .dot { background: var(--warn); }
.type-tag { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: var(--mono); }
.type-tag.local { background: rgba(83,184,255,.12); color: var(--accent); }
.type-tag.remote { background: rgba(240,179,75,.12); color: var(--warn); }
.endpoint-cell { font-family: var(--mono); font-size: 12px; color: var(--muted); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,.06); color: var(--muted); }
.live-indicator { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.live-indicator .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
.updated { text-align: right; font-size: 11px; color: var(--muted-2); margin-top: 8px; }
.empty-state { padding: 40px; text-align: center; color: var(--muted); font-size: 14px; }
.overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 100; align-items: center; justify-content: center; }
.overlay.open { display: flex; }
.panel { background: #0f1528; border: 1px solid var(--border); border-radius: 16px; width: 640px; max-width: 90vw; max-height: 85vh; overflow-y: auto; padding: 24px; }
.panel h2 { margin: 0 0 4px 0; font-size: 16px; }
.panel .psub { color: var(--muted); font-size: 12px; margin-bottom: 20px; }
.dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.dfield { }
.dfield .dl { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 2px; }
.dfield .dv { font-size: 13px; font-family: var(--mono); word-break: break-all; }
.dtools { }
.dtools .dth { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 8px; }
`;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCP Dashboard</title>
<style>/*CSS*/</style>
</head>
<body>
<div class="wrap" id="app">
  <div class="header">
    <h1>MCP Dashboard <span class="badge" id="versionBadge">v—</span></h1>
    <div><a href="/api" style="font-size:12px">View JSON API</a></div>
  </div>

  <div class="summary" id="summary"></div>

  <div class="filter-bar">
    <input type="text" placeholder="Search servers..." id="search" oninput="render()">
    <div class="tabs">
      <span class="tab active" data-f="all" onclick="setF(this,'all')">All</span>
      <span class="tab" data-f="running" onclick="setF(this,'running')">Running</span>
      <span class="tab" data-f="stopped" onclick="setF(this,'stopped')">Stopped</span>
      <span class="tab" data-f="local" onclick="setF(this,'local')">Local</span>
      <span class="tab" data-f="remote" onclick="setF(this,'remote')">Remote</span>
    </div>
    <div class="actions">
      <button class="btn" onclick="refresh()">Reload</button>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Server</th>
        <th>Type</th>
        <th>Endpoint</th>
        <th>Status</th>
        <th>Health</th>
        <th>Source</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <div class="updated" id="updated"></div>
</div>

<div class="overlay" id="overlay" onclick="if(event.target===this)closeD()">
  <div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div><h2 id="dName">—</h2><div class="psub" id="dSource">—</div></div>
      <button class="btn" onclick="closeD()" style="font-size:16px">&times;</button>
    </div>
    <div class="dgrid">
      <div class="dfield"><div class="dl">Type</div><div class="dv" id="dType">—</div></div>
      <div class="dfield"><div class="dl">Status</div><div class="dv" id="dStatus">—</div></div>
      <div class="dfield" style="grid-column:1/-1"><div class="dl">Endpoint</div><div class="dv" id="dEndpoint">—</div></div>
      <div class="dfield"><div class="dl">Enabled</div><div class="dv" id="dEnabled">—</div></div>
      <div class="dfield"><div class="dl">Engine Status</div><div class="dv" id="dEngine">—</div></div>
    </div>
    <div class="dtools" id="dTools">
      <div class="dth">Detailed checks</div>
      <div id="dChecks"></div>
      <div class="dth" style="margin-top:12px">Error</div>
      <div id="dError" style="color:var(--danger);font-size:12px"></div>
    </div>
    <div class="dtools" id="dConfigSection">
      <div class="dth">MCP Config (copy for your MCP client)</div>
      <pre id="dConfigPre" style="background:rgba(255,255,255,.06);border-radius:8px;padding:12px;font-size:11px;line-height:1.6;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:0 0 8px 0"></pre>
      <button class="btn" onclick="copyConfig()">Copy Config</button>
      <span id="dCopyResult" style="font-size:11px;color:var(--muted);margin-left:8px"></span>
    </div>
    <div style="margin-top:16px;display:flex;gap:8px">
      <button class="btn" id="dToggleBtn" onclick="toggleMCP()">Toggle Enable</button>
      <span style="font-size:11px;color:var(--muted);align-self:center" id="dToggleResult"></span>
    </div>
  </div>
</div>

<script>
let data = null, flt = 'all', poll = null;

async function fetchS() {
  try {
    const r = await fetch('/api');
    return r.ok ? r.json() : null;
  } catch { return null; }
}

function st(s) {
  if (s.engineStatus === 'connected') return 'running';
  if (s.type === 'local' && s.processRunning) return 'running';
  if (s.type === 'remote' && s.reachable) return 'running';
  if (s.error || s.engineStatus === 'disconnected') return 'stopped';
  if (s.enabled) return 'pending';
  return 'stopped';
}

function hi(s) {
  if (s.engineStatus === 'connected') return 'connected';
  if (s.type === 'local') return s.processRunning ? 'process up' : (s.enabled ? 'no process' : 'disabled');
  if (s.type === 'remote') return s.reachable ? 'reachable' : (s.enabled ? 'unreachable' : 'disabled');
  return '—';
}

async function refresh() {
  const r = await fetchS();
  if (!r) { return; }
  data = r;
  document.getElementById('versionBadge').textContent = r.statuses?.length + ' servers';
  render();
}

function render() {
  if (!data) return;
  const q = document.getElementById('search').value.toLowerCase();
  const list = (data.statuses||[]).filter(s => {
    if (flt==='running' && st(s)!=='running') return false;
    if (flt==='stopped' && st(s)==='running') return false;
    if (flt==='local' && s.type!=='local') return false;
    if (flt==='remote' && s.type!=='remote') return false;
    if (q && !s.name.toLowerCase().includes(q) && !s.endpoint.toLowerCase().includes(q)) return false;
    return true;
  });
  const total = (data.statuses||[]).length;
  const running = (data.statuses||[]).filter(s => st(s)==='running').length;
  const stopped = total - running;
  const hasErr = (data.statuses||[]).some(s => s.error);
  document.getElementById('summary').innerHTML =
    '<div class="card"><div class="label">Total MCP Servers</div><div class="value accent">'+total+'</div><div class="sub">configured</div></div>'+
    '<div class="card"><div class="label">Running</div><div class="value green">'+running+'</div><div class="sub">'+(total?Math.round(running/total*100):0)+'% healthy</div></div>'+
    '<div class="card"><div class="label">Stopped</div><div class="value '+(stopped?'red':'')+'">'+stopped+'</div><div class="sub">'+(hasErr?'has errors':'all idle')+'</div></div>';
  const tb = document.getElementById('tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="6"><div class="empty-state">No servers match</div></td></tr>';
  } else {
    tb.innerHTML = list.map(s => {
      const o = st(s);
      const dc = s.enabled ? '' : ' disabled';
      return '<tr onclick="showD(&apos;'+s.name+'&apos;)" class="'+dc+'" style="cursor:pointer">'+
        '<td><strong>'+esc(s.name)+'</strong></td>'+
        '<td><span class="type-tag '+s.type+'">'+s.type+'</span></td>'+
        '<td class="endpoint-cell">'+esc(s.endpoint)+'</td>'+
        '<td><span class="status-badge '+o+'"><span class="dot"></span>'+o+'</span></td>'+
        '<td style="font-size:12px">'+hi(s)+'</td>'+
        '<td><span class="source-tag">'+s.source+'</span></td>'+
        '</tr>';
    }).join('');
  }
  document.getElementById('updated').textContent = 'Updated '+new Date().toLocaleTimeString();
}

function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

function setF(el, f) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  flt = f;
  render();
}

function showD(name) {
  const s = (data?.statuses||[]).find(x => x.name === name);
  if (!s) return;
  document.getElementById('dName').textContent = s.name;
  document.getElementById('dSource').textContent = 'source: '+s.source;
  document.getElementById('dType').textContent = s.type === 'local' ? 'local (stdio)' : s.type === 'remote' ? 'remote (SSE)' : s.type;
  const o = st(s);
  document.getElementById('dStatus').textContent = o;
  document.getElementById('dStatus').style.color = o === 'running' ? 'var(--ok)' : 'var(--danger)';
  document.getElementById('dEndpoint').textContent = s.endpoint;
  document.getElementById('dEnabled').textContent = String(s.enabled);
  document.getElementById('dEngine').textContent = s.engineStatus || 'not synced';
  document.getElementById('dChecks').innerHTML =
    '<div style="font-size:12px;line-height:1.8">'+
    '  <div>Engine status: <strong>'+(s.engineStatus||'—')+'</strong></div>'+
    '  <div>Process running: <strong>'+(s.processRunning===null?'—':s.processRunning?'yes':'no')+'</strong></div>'+
    '  <div>URL reachable: <strong>'+(s.reachable===null?'—':s.reachable?'yes':'no')+'</strong></div>'+
    '</div>';
  document.getElementById('dError').textContent = s.error || '—';

  const config = s.config || {};
  const configBlock = document.getElementById('dConfigPre');
  const displayConfig = { ...config };
  delete displayConfig.enabled;
  configBlock.textContent = JSON.stringify(displayConfig, null, 2);
  document.getElementById('dCopyResult').textContent = '';

  document.getElementById('overlay').classList.add('open');
}

function copyConfig() {
  const text = document.getElementById('dConfigPre').textContent;
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById('dCopyResult').textContent = 'copied!';
    setTimeout(() => { document.getElementById('dCopyResult').textContent = ''; }, 1500);
  }).catch(() => {
    document.getElementById('dCopyResult').textContent = 'copy failed';
  });
}

function closeD() { document.getElementById('overlay').classList.remove('open'); }

async function toggleMCP() {
  const btn = document.getElementById('dToggleBtn');
  const name = document.getElementById('dName').textContent;
  const result = document.getElementById('dToggleResult');
  btn.disabled = true;
  result.textContent = 'toggling...';
  try {
    const r = await fetch('/api/' + encodeURIComponent(name) + '/toggle', { method: 'PUT' });
    if (!r.ok) throw new Error((await r.text()) || 'toggle failed');
    const j = await r.json();
    result.textContent = j.enabled ? 'enabled' : 'disabled';
    result.style.color = j.enabled ? 'var(--ok)' : 'var(--warn)';
    setTimeout(() => { closeD(); result.textContent = ''; }, 800);
  } catch (e) {
    result.textContent = e.message;
    result.style.color = 'var(--danger)';
  } finally {
    btn.disabled = false;
  }
  await refresh();
}

refresh();
if (poll) clearInterval(poll);
poll = setInterval(refresh, 5000);
</script>
</body>
</html>`;

const PORT = parseInt(process.env.PORT || "26316", 10);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api") {
    const statuses = await getStatuses();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ statuses, engineSync: null }));
    return;
  }

  if (url.pathname.startsWith("/api/") && req.method === "PUT") {
    const name = url.pathname.slice(5).replace(/\/toggle$/, "").replace(/^\//, "");

    if (name && url.pathname.endsWith("/toggle")) {
      try {
        const raw = await readFile(OPENCODE_JSON, "utf8");
        const config = JSON.parse(raw);
        if (config.mcp?.[name]) {
          const current = config.mcp[name];
          const enabled = current.enabled !== false;
          config.mcp[name] = { ...current, enabled: !enabled };
          await writeFile(OPENCODE_JSON, JSON.stringify(config, null, 2) + "\n");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name, enabled: !enabled }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "MCP not found" }));
        }
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }
  }

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML.replace("/*CSS*/", CSS));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MCP Dashboard running at http://127.0.0.1:${PORT}/dashboard`);
  console.log(`API at http://127.0.0.1:${PORT}/api`);
  console.log(`Config: ${OPENCODE_JSON}`);
  console.log(`Engine: ${ENGINE_URL}`);
});
