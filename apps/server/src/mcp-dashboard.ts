export const DASHBOARD_CSS = `:root {
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
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 8px; }
.header h1 { margin: 0; font-size: 20px; display: flex; align-items: center; gap: 10px; }
.header h1 .badge { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgba(81,214,156,.15); color: var(--ok); border: 1px solid rgba(81,214,156,.3); }
.engine-info { font-size: 12px; color: var(--muted); display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.engine-info .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.engine-info .dot.green { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
.engine-info .dot.red { background: var(--danger); box-shadow: 0 0 6px var(--danger); }
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
.btn { padding: 6px 14px; border-radius: 8px; font-size: 12px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; transition: all .15s; }
.btn:hover { background: rgba(255,255,255,.08); }
.btn.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 500; }
.table-wrap { background: linear-gradient(180deg, var(--panel), var(--panel-2)); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
thead th { text-align: left; padding: 10px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 500; }
tbody tr { border-bottom: 1px solid rgba(255,255,255,.05); transition: background .1s; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: rgba(255,255,255,.04); }
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
/* overlay */
.overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 100; align-items: center; justify-content: center; }
.overlay.open { display: flex; }
.panel { background: #0f1528; border: 1px solid var(--border); border-radius: 16px; width: 560px; max-width: 90vw; max-height: 80vh; overflow-y: auto; padding: 24px; }
.panel h2 { margin: 0 0 4px 0; font-size: 16px; }
.panel .psub { color: var(--muted); font-size: 12px; margin-bottom: 20px; }
.dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.dfield {}
.dfield .dl { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 2px; }
.dfield .dv { font-size: 13px; font-family: var(--mono); word-break: break-all; }
.dtools { }
.dtools .dth { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 8px; }
`;

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Engine Dashboard</title>
<style>/*CSS*/</style>
</head>
<body>
<div class="wrap" id="app">
  <div class="header">
    <h1>⚙️ Engine Dashboard <span class="badge" id="versionBadge">v—</span></h1>
    <div class="engine-info" id="engineInfo">
      <span id="engineStatus"><span class="dot green"></span> Loading...</span>
      <span class="live-indicator"><span class="pulse"></span> LIVE</span>
    </div>
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
      <button class="btn" onclick="refresh()">⟳ Refresh</button>
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

<!-- detail overlay -->
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
  </div>
</div>

<script>
let data = null, flt = 'all', poll = null;

async function fetchS() {
  try {
    const r = await fetch('./status');
    return r.ok ? r.json() : null;
  } catch { return null; }
}

function st(s) {
  if (s.engineStatus === 'connected') return 'running';
  if (s.type === 'local' && s.processRunning) return 'running';
  if (s.type === 'remote' && s.reachable) return 'running';
  if (s.error || s.engineStatus === 'disconnected') return 'stopped';
  if (s.engineStatus || s.enabled) return 'pending';
  return 'stopped';
}

function hi(s) {
  if (s.engineStatus === 'connected') return '✅ connected';
  if (s.type === 'local') return s.processRunning ? '✅ process up' : (s.enabled ? '⏳ no process' : '⬜ disabled');
  if (s.type === 'remote') return s.reachable ? '✅ reachable' : (s.enabled ? '⏳ unreachable' : '⬜ disabled');
  return '—';
}

async function refresh() {
  const r = await fetchS();
  if (!r) {
    document.getElementById('engineStatus').innerHTML = '<span class="dot red"></span> Engine unreachable';
    return;
  }
  data = r;
  document.getElementById('engineStatus').innerHTML = '<span class="dot green"></span> Engine connected';
  const sync = r.engineSync;
  if (sync) {
    const l = sync.status === 'ok' ? 'Sync OK' : sync.failures.length+' failure(s)';
    document.getElementById('versionBadge').textContent = l;
  }
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
    '<div class="card"><div class="label">Stopped</div><div class="value '+(stopped?'red':'')+'">'+stopped+'</div><div class="sub">'+(hasErr?'has errors':'all idle')+'</div></div>'+
    '<div class="card"><div class="label">Engine Sync</div><div class="value '+(data.engineSync?.status==='ok'?'green':'warn')+'">'+(data.engineSync?.status==='ok'?'OK':data.engineSync?.failures?.length||'?')+'</div><div class="sub">'+(data.engineSync?.at?new Date(data.engineSync.at).toLocaleTimeString():'—')+'</div></div>';
  const tb = document.getElementById('tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="6"><div class="empty-state">No servers match</div></td></tr>';
  } else {
    tb.innerHTML = list.map(s => {
      const o = st(s);
      return '<tr onclick="showD(\''+s.name+'\')" style="cursor:pointer">'+
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
  document.getElementById('dEnabled').textContent = String(s.enabled) + (s.disabledByTools ? ' (denied by tool patterns)' : '');
  document.getElementById('dEngine').textContent = s.engineStatus || 'not synced';
  document.getElementById('dChecks').innerHTML =
    '<div style="font-size:12px;line-height:1.8">'+
    '  <div>Engine status: <strong>'+(s.engineStatus||'—')+'</strong></div>'+
    '  <div>Process running: <strong>'+(s.processRunning===null?'—':s.processRunning?'yes':'no')+'</strong></div>'+
    '  <div>URL reachable: <strong>'+(s.reachable===null?'—':s.reachable?'yes':'no')+'</strong></div>'+
    '</div>';
  document.getElementById('dError').textContent = s.error || '—';
  document.getElementById('overlay').classList.add('open');
}

function closeD() { document.getElementById('overlay').classList.remove('open'); }

refresh();
if (poll) clearInterval(poll);
poll = setInterval(refresh, 5000);
</script>
</body>
</html>`;

export function dashboardHtmlResponse(): Response {
  const html = DASHBOARD_HTML.replace("/*CSS*/", DASHBOARD_CSS);
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
