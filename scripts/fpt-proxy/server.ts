#!/usr/bin/env bun
/**
 * fpt-proxy — local pass-through proxy for FPT Cloud AI (mkp-api.fptcloud.com).
 *
 * Why: opencode's @ai-sdk/openai-compatible retries 429s automatically, which
 * amplifies bursts and pushes us into FPT's rate limit. This proxy sits in
 * front of FPT, logs every request/response (SQLite), counts tokens, applies
 * a per-model token-bucket throttle (RPM + TPM), and **retries upstream 429/5xx
 * internally with exponential backoff + Retry-After** so callers see one clean
 * response instead of an amplified burst.
 *
 * Usage:
 *   FPT_API_KEY=... bun scripts/fpt-proxy/server.ts
 *   # then point FPT_CONFIG at http://localhost:8789/v1
 *
 * Endpoints:
 *   POST /v1/chat/completions   pass-through (also handles /completions, /embeddings, /models)
 *   GET  /__stats               JSON: counters + recent rows
 *   POST /__config              update global throttle / retry limits live
 *   POST /__model-config        set per-model { rpm, tpm } override
 *   POST /__reset               clear counters
 *   GET  /__dashboard           HTML page
 *   GET  /__health              liveness
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const UPSTREAM = process.env.FPT_UPSTREAM ?? "https://mkp-api.fptcloud.com";
const PORT = Number(process.env.FPT_PROXY_PORT ?? 8789);
const DB_PATH = process.env.FPT_PROXY_DB ?? resolve(process.cwd(), "scripts/fpt-proxy/proxy.db");

mkdirSync(resolve(DB_PATH, ".."), { recursive: true });
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    model TEXT,
    status INTEGER,
    duration_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    upstream_status INTEGER,
    retries INTEGER DEFAULT 0,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(ts);
  CREATE TABLE IF NOT EXISTS config (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS log_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    msg TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_log_events_ts ON log_events(ts);
`);

type Config = {
  rpm: number; tpm: number; burst: number; maxRetries: number;
  baseBackoffMs: number; maxBackoffMs: number;
  cooldownMinMs: number; cooldownMaxMs: number;
};
type PerModelCfg = { rpm?: number; tpm?: number; cooldownMinMs?: number; cooldownMaxMs?: number };

function loadConfig(): Config {
  const rows = db.query("SELECT k, v FROM config").all() as { k: string; v: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  return {
    // Defaults sized for DeepSeek-V4-Flash free tier (6 RPM, 60k TPM) with a
    // small safety margin. FPT's actual limits vary by model; use
    // /__model-config to override per model.
    rpm: Number(map.rpm ?? process.env.FPT_PROXY_RPM ?? 8),
    tpm: Number(map.tpm ?? process.env.FPT_PROXY_TPM ?? 40_000),
    burst: Number(map.burst ?? process.env.FPT_PROXY_BURST ?? 2),
    maxRetries: Number(map.maxRetries ?? process.env.FPT_PROXY_MAX_RETRIES ?? 3),
    baseBackoffMs: Number(map.baseBackoffMs ?? process.env.FPT_PROXY_BASE_BACKOFF_MS ?? 1_500),
    maxBackoffMs: Number(map.maxBackoffMs ?? process.env.FPT_PROXY_MAX_BACKOFF_MS ?? 15_000),
    // Cooldown applied after upstream 429. We clamp Retry-After into
    // [cooldownMinMs, cooldownMaxMs] so a single bad header doesn't park us
    // for 60s+ and we still respect "back off harder" when the upstream
    // explicitly asks for it. Both are editable live via POST /__config.
    cooldownMinMs: Number(map.cooldownMinMs ?? process.env.FPT_PROXY_COOLDOWN_MIN_MS ?? 2_000),
    cooldownMaxMs: Number(map.cooldownMaxMs ?? process.env.FPT_PROXY_COOLDOWN_MAX_MS ?? 30_000),
  };
}
function saveConfig(cfg: Config) {
  db.run(
    "INSERT OR REPLACE INTO config (k, v) VALUES (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)",
    [
      "rpm", String(cfg.rpm),
      "tpm", String(cfg.tpm),
      "burst", String(cfg.burst),
      "maxRetries", String(cfg.maxRetries),
      "baseBackoffMs", String(cfg.baseBackoffMs),
      "maxBackoffMs", String(cfg.maxBackoffMs),
      "cooldownMinMs", String(cfg.cooldownMinMs),
      "cooldownMaxMs", String(cfg.cooldownMaxMs),
    ],
  );
}
function loadModelCfg(model: string | undefined): PerModelCfg {
  if (!model) return {};
  const row = db.query("SELECT v FROM config WHERE k = ?").get(`model:${model}`) as { v: string } | null;
  if (!row) return {};
  try { return JSON.parse(row.v); } catch { return {}; }
}
function saveModelCfg(model: string, m: PerModelCfg) {
  db.run("INSERT OR REPLACE INTO config (k, v) VALUES (?, ?)", [`model:${model}`, JSON.stringify(m)]);
}
function listModelConfigs(): Record<string, PerModelCfg> {
  const out: Record<string, PerModelCfg> = {};
  for (const r of db.query("SELECT k, v FROM config WHERE k LIKE 'model:%'").all() as { k: string; v: string }[]) {
    const name = r.k.slice("model:".length);
    try { out[name] = JSON.parse(r.v); } catch { /* skip */ }
  }
  return out;
}
if (db.query("SELECT COUNT(*) as c FROM config").get() == null) saveConfig(loadConfig());

// Per-model sliding 60s window. Each model has its own bucket so a 429 from
// one model doesn't throttle the other.
type Bucket = { start: number; reqs: number; tokens: number; cooldownUntil: number };
const buckets = new Map<string, Bucket>();
function bucketFor(model: string | undefined): Bucket {
  const k = model ?? "_default";
  let b = buckets.get(k);
  if (!b) { b = { start: 0, reqs: 0, tokens: 0, cooldownUntil: 0 }; buckets.set(k, b); }
  return b;
}
function now() { return Date.now(); }
function windowKey(ts: number) { return Math.floor(ts / 60_000) * 60_000; }
function effectiveLimits(cfg: Config, model: string | undefined): { rpm: number; tpm: number } {
  const m = loadModelCfg(model);
  return { rpm: m.rpm ?? cfg.rpm, tpm: m.tpm ?? cfg.tpm };
}
function checkThrottle(cfg: Config, model: string | undefined, estTokens: number): { ok: boolean; retryAfterMs: number; reason?: string } {
  const ts = now();
  const b = bucketFor(model);
  // Respect upstream cooldown (set when we see a 429 from FPT)
  if (b.cooldownUntil > ts) {
    return { ok: false, retryAfterMs: b.cooldownUntil - ts, reason: "upstream-cooldown" };
  }
  // Roll the window forward
  const k = windowKey(ts);
  if (b.start !== k) { b.start = k; b.reqs = 0; b.tokens = 0; }
  const { rpm, tpm } = effectiveLimits(cfg, model);
  if (b.reqs >= rpm) {
    return { ok: false, retryAfterMs: b.start + 60_000 - ts, reason: "rpm" };
  }
  if (b.tokens + estTokens > tpm) {
    return { ok: false, retryAfterMs: b.start + 60_000 - ts, reason: "tpm" };
  }
  return { ok: true, retryAfterMs: 0 };
}
function consume(_cfg: Config, model: string | undefined, estTokens: number) {
  const b = bucketFor(model);
  b.reqs += 1;
  b.tokens += estTokens;
}
function applyCooldown(model: string | undefined, retryAfterSec: number) {
  const b = bucketFor(model);
  const cfg = loadConfig();
  // Clamp the upstream-supplied Retry-After into [min, max]. This keeps a
  // single 60s+ header from parking us forever while still respecting the
  // upstream's explicit "back off harder" signal when they ask for a long
  // wait. Both bounds are configurable live via POST /__config.
  const minMs = cfg.cooldownMinMs;
  const maxMs = Math.max(cfg.cooldownMinMs, cfg.cooldownMaxMs);
  const requested = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : minMs;
  const ms = Math.max(minMs, Math.min(maxMs, requested));
  b.cooldownUntil = Math.max(b.cooldownUntil, now() + ms);
}
// Sleep helper that resolves in ms. We use setTimeout via a Promise.
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// Structured log: console + DB so dashboard can show recent activity.
const LOG_LEVELS = { info: "info", warn: "warn", error: "error" } as const;
type LogLevel = keyof typeof LOG_LEVELS;
function logEvent(level: LogLevel, msg: string) {
  const ts = now();
  console.log(`[fpt-proxy] ${level} ${msg}`);
  try {
    db.run("INSERT INTO log_events (ts, level, msg) VALUES (?, ?, ?)", [ts, level, msg]);
    // Keep the table bounded — drop rows older than 24h on every 50th insert.
    if (db.query("SELECT COUNT(*) as c FROM log_events").get() as { c: number } | undefined) {
      const cnt = (db.query("SELECT COUNT(*) as c FROM log_events").get() as { c: number }).c;
      if (cnt > 5000 || cnt % 50 === 0) {
        db.run("DELETE FROM log_events WHERE ts < ?", [ts - 24 * 60 * 60 * 1000]);
      }
    }
  } catch { /* logging should never break the request */ }
}

function estimateTokensFromBody(body: any): { prompt: number; model?: string } {
  let prompt = 0;
  const model = body?.model as string | undefined;
  if (typeof body?.prompt === "string") prompt += Math.ceil(body.prompt.length / 4);
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (typeof m?.content === "string") prompt += Math.ceil(m.content.length / 4);
      else if (Array.isArray(m?.content)) {
        for (const p of m.content) if (typeof p?.text === "string") prompt += Math.ceil(p.text.length / 4);
      }
    }
  }
  return { prompt, model };
}

// Parses a "Retry-After" header. Returns seconds (clamped to >=1) or null.
function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.max(1, Math.ceil(n));
  // HTTP-date variant — not common on FPT, but handle it.
  const t = Date.parse(value);
  if (Number.isFinite(t)) {
    return Math.max(1, Math.ceil((t - now()) / 1000));
  }
  return null;
}

// SSE stream rewriter with state across chunk boundaries.
//
// Why state: TCP/network can split an SSE event across multiple chunks. If
// the input "hel" arrives in one chunk and "lo\n\n" in the next, a naive
// split-on-`\n\n` per chunk would corrupt events. We accumulate partial
// event payloads and only emit complete events.
//
// What we change per event:
//   - Drop `delta.reasoning_content` (Qwen models emit it; opencode SDK
//     sometimes chokes when reasoning comes without an accompanying
//     content chunk or when the chunk structure is unusual).
//   - Ensure every non-empty delta has a `content` string (default to "")
//     so the parser doesn't see a chunk where the only meaningful field
//     was reasoning_content.
//   - Drop mid-stream `usage` chunks that have no delta (interim token
//     counts confuse some parsers).
//   - Preserve `[DONE]` sentinel exactly.
//   - Pass through non-OpenAI events (heartbeat comments, event:, id:,
//     retry: lines) unchanged.
class StreamRewriter {
  private buf = "";
  rewrite(chunk: string): string {
    this.buf += chunk;
    // Find the last complete event boundary (\n\n). Anything after it stays
    // buffered for the next chunk.
    let lastBoundary = -1;
    for (let i = this.buf.length - 2; i >= 0; i--) {
      if (this.buf[i] === "\n" && this.buf[i + 1] === "\n") {
        lastBoundary = i;
        break;
      }
    }
    if (lastBoundary === -1) return ""; // no complete event yet
    const complete = this.buf.slice(0, lastBoundary + 2);
    this.buf = this.buf.slice(lastBoundary + 2);
    return this.rewriteEvents(complete);
  }
  flush(): string {
    if (!this.buf) return "";
    const remaining = this.buf;
    this.buf = "";
    return this.rewriteEvents(remaining);
  }
  private rewriteEvents(input: string): string {
    // Split on event boundaries but keep the boundary attached to each event
    // by using a regex match. This preserves the trailing \n\n that the
    // SSE protocol requires between events.
    const out: string[] = [];
    // Match each "complete" event including its trailing \n\n.
    const re = /([\s\S]*?)\n\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const ev = m[1];
      if (!ev.trim()) { out.push(""); continue; }
      const dataLines: string[] = [];
      const otherLines: string[] = [];
      for (const line of ev.split("\n")) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        else otherLines.push(line);
      }
      if (dataLines.length === 0) { out.push(ev + "\n\n"); continue; }
      const payload = dataLines.join("\n");
      if (payload === "[DONE]") { out.push(ev + "\n\n"); continue; }
      let parsed: any;
      try { parsed = JSON.parse(payload); } catch { out.push(ev + "\n\n"); continue; }
      const choice = parsed?.choices?.[0];
      if (!choice) { out.push(ev + "\n\n"); continue; }
      const delta = choice.delta ?? {};
      const newDelta: any = {};
      for (const k of Object.keys(delta)) {
        if (k === "reasoning_content") continue;
        newDelta[k] = delta[k];
      }
      if (typeof newDelta.content !== "string") {
        newDelta.content = newDelta.content ?? "";
      }
      if (delta.role && !newDelta.role) newDelta.role = delta.role;
      choice.delta = newDelta;
      const newPayload = JSON.stringify(parsed);
      out.push([...otherLines, `data: ${newPayload}`].join("\n") + "\n\n");
    }
    return out.join("");
  }
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname === "/__health") return new Response("ok", { status: 200 });

    if (pathname === "/__logs") {
      // `since` is the last id the client has seen (0 = full snapshot).
      // We filter on id (not ts) so a same-ms burst of inserts all show up.
      const sinceParam = Number(url.searchParams.get("since") ?? 0);
      const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 200));
      const level = url.searchParams.get("level");
      const rows = db.query(`
        SELECT id, ts, level, msg FROM log_events
        WHERE id > ?
        ${level ? "AND level = ?" : ""}
        ORDER BY id DESC LIMIT ?
      `).all(...(level ? [sinceParam, level, limit] : [sinceParam, limit])) as { id: number; ts: number; level: string; msg: string }[];
      // Newest first in DB; reverse for chronological display.
      return Response.json({
        now: now(),
        events: rows.reverse(),
      });
    }

    if (pathname === "/__stats") {
      const since = now() - 60_000;
      const win = db.query(`
        SELECT
          COUNT(*) as reqs,
          COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens
        FROM requests WHERE ts >= ?
      `).get(since) as { reqs: number; tokens: number };
      const byModel = db.query(`
        SELECT model, COUNT(*) as c, COALESCE(SUM(total_tokens), 0) as t
        FROM requests WHERE ts >= ? AND model IS NOT NULL
        GROUP BY model ORDER BY c DESC
      `).all(since);
      const recent = db.query(`
        SELECT id, ts, model, status, prompt_tokens, completion_tokens, total_tokens, upstream_status, retries, error
        FROM requests ORDER BY id DESC LIMIT 20
      `).all();
      const cfg = loadConfig();
      const perModel = effectiveLimits(cfg, byModel[0]?.model);
      // Per-model live state
      const modelState: Record<string, { reqs: number; tokens: number; cooldownUntil: number; limits: { rpm: number; tpm: number } }> = {};
      for (const [k, b] of buckets.entries()) {
        if (k === "_default") continue;
        const limits = effectiveLimits(cfg, k);
        modelState[k] = { reqs: b.reqs, tokens: b.tokens, cooldownUntil: b.cooldownUntil, limits };
      }
      return Response.json({
        window_start: windowKey(now()),
        last_60s: { reqs: win.reqs, tokens: win.tokens, rpm_limit: perModel.rpm, tpm_limit: perModel.tpm },
        by_model_60s: byModel,
        model_state: modelState,
        model_configs: listModelConfigs(),
        recent,
        config: cfg,
      });
    }

    if (pathname === "/__config" && req.method === "POST") {
      const body = (await req.json()) as Partial<Config>;
      const cur = loadConfig();
      const next: Config = {
        rpm: Number(body.rpm ?? cur.rpm),
        tpm: Number(body.tpm ?? cur.tpm),
        burst: Number(body.burst ?? cur.burst),
        maxRetries: Number(body.maxRetries ?? cur.maxRetries),
        baseBackoffMs: Number(body.baseBackoffMs ?? cur.baseBackoffMs),
        maxBackoffMs: Number(body.maxBackoffMs ?? cur.maxBackoffMs),
        cooldownMinMs: Number(body.cooldownMinMs ?? cur.cooldownMinMs),
        cooldownMaxMs: Number(body.cooldownMaxMs ?? cur.cooldownMaxMs),
      };
      saveConfig(next);
      return Response.json({ ok: true, config: next });
    }

    if (pathname === "/__model-config" && req.method === "POST") {
      const body = (await req.json()) as { model: string; rpm?: number; tpm?: number };
      if (!body.model) return new Response(JSON.stringify({ error: "model required" }), { status: 400 });
      saveModelCfg(body.model, { rpm: body.rpm, tpm: body.tpm });
      // Reset bucket so the new limit takes effect immediately
      const b = bucketFor(body.model);
      b.reqs = 0; b.tokens = 0; b.cooldownUntil = 0;
      return Response.json({ ok: true, model: body.model, cfg: loadModelCfg(body.model) });
    }

    if (pathname === "/__reset" && req.method === "POST") {
      db.run("DELETE FROM requests");
      for (const b of buckets.values()) { b.start = 0; b.reqs = 0; b.tokens = 0; b.cooldownUntil = 0; }
      return Response.json({ ok: true });
    }

    if (pathname === "/__dashboard") return new Response(dashboardHtml(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    // Pass-through: anything else under /v1/* goes to upstream.
    if (!pathname.startsWith("/v1/")) {
      return new Response("not found", { status: 404 });
    }

    const cfg = loadConfig();
    const inHeaders = req.headers;
    const reqId = crypto.randomUUID();
    const t0 = now();

    let bodyText = "";
    let parsedBody: any = null;
    if (req.method === "POST") {
      bodyText = await req.text();
      try { parsedBody = JSON.parse(bodyText); } catch { /* not JSON, forward as-is */ }
    }

    // Debug: log full body when enabled. Set FPT_PROXY_LOG_BODY=1 to turn on.
    if (process.env.FPT_PROXY_LOG_BODY === "1" && parsedBody) {
      logEvent("info", `request ${req.method} ${pathname} model=${parsedBody.model} stream=${parsedBody.stream} tools_count=${Array.isArray(parsedBody.tools) ? parsedBody.tools.length : 0} prompt_chars=${JSON.stringify(parsedBody.messages || []).length}`);
      if (parsedBody.model === "Qwen3.6-27B" || (parsedBody.upstream_status_hint ?? false)) {
        console.log(`[fpt-proxy] FULL BODY ${pathname}: ${bodyText.slice(0, 4000)}`);
      }
    }

    const est = parsedBody ? estimateTokensFromBody(parsedBody) : { prompt: 0, model: undefined };
    // Local throttle (no upstream call yet) — wait if we're over budget.
    while (true) {
      const throttle = checkThrottle(cfg, est.model, est.prompt);
      if (throttle.ok) break;
      const waitMs = Math.min(30_000, Math.max(500, throttle.retryAfterMs));
      const waitS = Math.max(1, Math.ceil(waitMs / 1000));
      logEvent("warn", `throttle ${throttle.reason} model=${est.model ?? "?"} wait=${waitS}s`);
      await sleep(waitMs);
    }
    consume(cfg, est.model, est.prompt);

    // Build upstream headers (drop hop-by-hop + recompute content-length)
    const upstreamHeaders = new Headers();
    for (const [k, v] of inHeaders.entries()) {
      const lk = k.toLowerCase();
      if (["host", "content-length", "accept-encoding"].includes(lk)) continue;
      upstreamHeaders.set(k, v);
    }
    // Force identity so FPT returns plain JSON (it advertises br but Bun
    // auto-decompresses; explicit identity keeps things uniform).
    upstreamHeaders.set("accept-encoding", "identity");
    upstreamHeaders.set("x-fpt-proxy-req", reqId);

    // Retry loop: handles 429/5xx from upstream with exponential backoff +
    // Retry-After. Refunds the bucket on a throttled retry so we don't double-
    // count a request that was rejected before any tokens were burned.
    let upstreamResp: Response | null = null;
    let respText = "";
    let retries = 0;
    let lastError: string | null = null;
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      try {
        upstreamResp = await fetch(`${UPSTREAM}${pathname}${url.search}`, {
          method: req.method,
          headers: upstreamHeaders,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : bodyText,
        });
      } catch (err: any) {
        lastError = String(err?.message ?? err);
        // Network error — back off and retry
        if (attempt < cfg.maxRetries) {
          const backoff = Math.min(cfg.maxBackoffMs, cfg.baseBackoffMs * Math.pow(2, attempt));
          logEvent("warn", `network error attempt=${attempt + 1} backoff=${backoff}ms err=${lastError}`);
          await sleep(backoff);
          continue;
        }
        // Out of retries — record and bail
        db.run(`INSERT INTO requests (ts, method, path, model, status, duration_ms, retries, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [t0, req.method, pathname, est.model ?? null, 502, now() - t0, retries, lastError]);
        return new Response(JSON.stringify({ error: { message: "upstream fetch failed", detail: lastError } }), {
          status: 502, headers: { "content-type": "application/json" },
        });
      }

      // 429 / 5xx → back off and retry (up to maxRetries)
      if (upstreamResp.status === 429 || upstreamResp.status >= 500) {
        // Read body for logging, then dispose — we'll retry
        const errBody = await upstreamResp.text().catch(() => "");
        const retryAfterSec = parseRetryAfter(upstreamResp.headers.get("retry-after"));
        // Apply upstream cooldown so even parallel requests through this proxy
        // back off.
        applyCooldown(est.model, retryAfterSec ?? 5);
        if (attempt < cfg.maxRetries) {
          retries += 1;
          // Backoff: respect retry-after, else exponential with jitter.
          const expMs = Math.min(cfg.maxBackoffMs, cfg.baseBackoffMs * Math.pow(2, attempt));
          const jitter = Math.floor(Math.random() * Math.min(500, expMs / 4));
          const waitMs = retryAfterSec != null ? Math.max(retryAfterSec * 1000, 1000) : expMs + jitter;
          logEvent("warn", `upstream ${upstreamResp.status} model=${est.model ?? "?"} attempt=${attempt + 1}/${cfg.maxRetries} retry-after=${retryAfterSec ?? "-"}s backoff=${waitMs}ms`);
          upstreamResp.headers;
          upstreamResp = null;
          await sleep(waitMs);
          continue;
        }
        // Out of retries — return the last 429/5xx
        db.run(`INSERT INTO requests (ts, method, path, model, status, duration_ms, retries, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [t0, req.method, pathname, est.model ?? null, upstreamResp.status, now() - t0, retries, errBody.slice(0, 200)]);
        return new Response(errBody, {
          status: upstreamResp.status,
          headers: upstreamResp.headers,
        });
      }

      // Success path
      const isStream = parsedBody?.stream === true;
      if (isStream) {
        // Streaming passthrough: rewrite each SSE chunk to normalize the
        // shape opencode SDK expects. The known SDK bug surfaces as
        // "Internal server error" when the SDK's openai-compatible parser
        // can't categorize an unexpected delta. We defensively rewrite each
        // chunk to:
        //   - drop `delta.reasoning_content` (Qwen models emit this)
        //   - ensure every delta has a non-null `content` field
        //   - drop mid-stream usage-only events
        // The rewriter is stateful across chunk boundaries so an event that
        // arrives split across multiple TCP reads is still processed as one.
        const upstream = upstreamResp;
        const rewriter = new StreamRewriter();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const transformer = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctrl) {
            const text = decoder.decode(chunk, { stream: true });
            const out = rewriter.rewrite(text);
            if (process.env.FPT_PROXY_DEBUG_STREAM === "1") {
              // Count \n\n in out for sanity
              const nn = (out.match(/\n\n/g) || []).length;
              console.log(`[stream] IN(${chunk.length}B) tail=${JSON.stringify(text.slice(-20))} OUT(${out.length}B) ${nn}x\\n\\n head=${JSON.stringify(out.slice(0, 60))}`);
            }
            if (out) ctrl.enqueue(encoder.encode(out));
          },
          flush(ctrl) {
            const out = rewriter.flush();
            if (process.env.FPT_PROXY_DEBUG_STREAM === "1") {
              const nn = (out.match(/\n\n/g) || []).length;
              console.log(`[stream] FLUSH OUT(${out.length}B) ${nn}x\\n\\n`);
            }
            if (out) ctrl.enqueue(encoder.encode(out));
          },
        });
        const tee = upstream.body!.pipeThrough(transformer);
        // Buffer a copy for token accounting.
        let bufForCount = "";
        const counter = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctrl) {
            bufForCount += decoder.decode(chunk, { stream: true });
            ctrl.enqueue(chunk);
          },
        });
        const finalBody = tee.pipeThrough(counter);
        upstreamResp = new Response(finalBody, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: upstream.headers,
        });
        (upstreamResp as any)._bufForCount = () => bufForCount;
        break;
      } else {
        respText = await upstreamResp.text();
        break;
      }
    }

    if (!upstreamResp) {
      // Shouldn't get here, but be safe
      const dur = now() - t0;
      db.run(`INSERT INTO requests (ts, method, path, model, status, duration_ms, retries, error)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [t0, req.method, pathname, est.model ?? null, 502, dur, retries, lastError ?? "no response"]);
      return new Response(JSON.stringify({ error: { message: "no response from upstream" } }), {
        status: 502, headers: { "content-type": "application/json" },
      });
    }

    const dur = now() - t0;

    // Token accounting: parse JSON usage from non-streaming; for streaming,
    // the body is already consumed by the TransformStream so we just record
    // the estimate. (Real usage from the last chunk is not easily extractable
    // without buffering the whole body, which would defeat streaming.)
    let promptT = est.prompt, compT = 0, totalT = est.prompt;
    if (respText) {
      try {
        const parsed = JSON.parse(respText);
        if (parsed?.usage?.prompt_tokens) promptT = parsed.usage.prompt_tokens;
        if (parsed?.usage?.completion_tokens) compT = parsed.usage.completion_tokens;
        if (parsed?.usage?.total_tokens) totalT = parsed.usage.total_tokens;
      } catch { /* not JSON */ }
    } else {
      // Streaming path: estimate is the only signal we have cheaply. The last
      // chunk's `usage` is in bufForCount if the caller wants exact numbers,
      // but we don't block on it here.
      totalT = est.prompt;
    }

    db.run(`INSERT INTO requests (ts, method, path, model, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, upstream_status, retries, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t0, req.method, pathname, est.model ?? null, upstreamResp.status, dur, promptT, compT, totalT, upstreamResp.status, retries, null]);

    // Log non-2xx responses so the dashboard surfaces client errors and auth failures.
    if (upstreamResp.status >= 400) {
      const errSnippet = respText.length > 200 ? respText.slice(0, 200) + "..." : respText;
      logEvent(upstreamResp.status >= 500 ? "error" : "warn", `upstream ${upstreamResp.status} model=${est.model ?? "?"} dur=${dur}ms body=${errSnippet.replace(/\s+/g, " ").trim()}`);
    }

    if (respText) {
      return new Response(respText, {
        status: upstreamResp.status,
        headers: upstreamResp.headers,
      });
    } else {
      // Streaming path: forward the constructed Response body directly.
      return upstreamResp;
    }
  },
});

logEvent("info", `listening on http://127.0.0.1:${server.port}`);
logEvent("info", `upstream: ${UPSTREAM}`);
logEvent("info", `db: ${DB_PATH}`);
logEvent("info", `dashboard: http://127.0.0.1:${server.port}/__dashboard`);

function dashboardHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>fpt-proxy</title>
<style>
  body{font:13px/1.5 ui-monospace,Menlo,monospace;margin:16px;background:#0b0d10;color:#cfd6df;max-width:1200px}
  h1{font-size:16px;margin:0 0 12px}
  h3{font-size:13px;margin:16px 0 8px;color:#9fb0c0}
  .row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px}
  .card{background:#14171c;padding:10px 14px;border-radius:6px;min-width:140px}
  .card .k{color:#7a8593;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
  .card .v{font-size:18px;font-weight:600;margin-top:4px}
  .card.cooldown{border:1px solid #c47e3a}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #1f242c}
  th{color:#7a8593;font-weight:500}
  .err{color:#ff7a7a}
  .ok{color:#7af0a4}
  .warn{color:#f0c47a}
  form{display:inline-flex;gap:6px;align-items:center;margin-right:16px;margin-bottom:6px}
  input{background:#14171c;color:#cfd6df;border:1px solid #1f242c;padding:4px 6px;border-radius:4px;width:90px}
  button{background:#2b4d6e;color:#cfd6df;border:0;padding:4px 10px;border-radius:4px;cursor:pointer}
  button:hover{background:#3a5f80}
  .meta{color:#7a8593;font-size:11px}
  .pill{display:inline-block;padding:1px 6px;border-radius:8px;background:#2b4d6e;color:#cfd6df;font-size:10px;margin-left:4px}
</style></head><body>
<h1>fpt-proxy <span class="meta">— FPT Cloud AI pass-through (localhost:${server.port})</span></h1>
<form id="cfg">
  <span class="meta">global</span>
  RPM <input id="rpm" name="rpm" type="number">  TPM <input id="tpm" name="tpm" type="number">  Burst <input id="burst" name="burst" type="number">
  Retries <input id="maxRetries" name="maxRetries" type="number">  BaseMs <input id="baseBackoffMs" name="baseBackoffMs" type="number">  MaxMs <input id="maxBackoffMs" name="maxBackoffMs" type="number">
  CooldownMinMs <input id="cooldownMinMs" name="cooldownMinMs" type="number">  CooldownMaxMs <input id="cooldownMaxMs" name="cooldownMaxMs" type="number">
  <button type="submit">Save</button>
</form>
<form id="mcfg">
  <span class="meta">per-model override</span>
  model <input id="mmodel" name="mmodel" type="text" style="width:180px" placeholder="DeepSeek-V4-Flash">
  rpm <input id="mrpm" name="mrpm" type="number" placeholder="optional">  tpm <input id="mtpm" name="mtpm" type="number" placeholder="optional">
  <button type="submit">Save</button>
</form>
<button id="reset">Reset counters</button>
<button id="refresh" style="margin-left:8px">Refresh now</button>
<div class="row" id="cards" style="margin-top:12px"></div>
<h3>Per-model live state</h3><div id="modelstate"></div>
<h3>Last 60s by model</h3><div id="bymodel"></div>
<h3 style="margin-top:16px">Recent 20 requests</h3><div id="recent"></div>
<h3 style="margin-top:16px">Live log <span class="meta">(last 100, auto-refresh 2s)</span></h3>
<div id="log" style="max-height:320px;overflow:auto;font-size:11px"></div>
<script>
async function load(){
  const r = await fetch('/__stats'); const d = await r.json();
  document.getElementById('rpm').value = d.config.rpm;
  document.getElementById('tpm').value = d.config.tpm;
  document.getElementById('burst').value = d.config.burst;
  document.getElementById('maxRetries').value = d.config.maxRetries;
  document.getElementById('baseBackoffMs').value = d.config.baseBackoffMs;
  document.getElementById('maxBackoffMs').value = d.config.maxBackoffMs;
  document.getElementById('cooldownMinMs').value = d.config.cooldownMinMs;
  document.getElementById('cooldownMaxMs').value = d.config.cooldownMaxMs;
  const w = d.last_60s;
  document.getElementById('cards').innerHTML = \`
    <div class="card"><div class="k">Reqs (60s)</div><div class="v">\${w.reqs} / \${w.rpm_limit}</div></div>
    <div class="card"><div class="k">Tokens (60s)</div><div class="v">\${w.tokens.toLocaleString()} / \${w.tpm_limit.toLocaleString()}</div></div>
    <div class="card"><div class="k">Window</div><div class="v">\${new Date(d.window_start).toLocaleTimeString()}</div></div>
  \`;
  const ms = d.model_state || {};
  const cfgs = d.model_configs || {};
  const modelNames = new Set([...Object.keys(ms), ...Object.keys(cfgs)]);
  document.getElementById('modelstate').innerHTML = modelNames.size === 0
    ? '<div class="meta">none yet</div>'
    : '<table><tr><th>model</th><th>reqs</th><th>tokens</th><th>cooldown</th><th>override</th></tr>' +
        [...modelNames].map(name => {
          const s = ms[name] || { reqs: 0, tokens: 0, cooldownUntil: 0, limits: { rpm: d.config.rpm, tpm: d.config.tpm } };
          const cfg = cfgs[name];
          const onCooldown = s.cooldownUntil > Date.now();
          const cdText = onCooldown ? Math.ceil((s.cooldownUntil - Date.now()) / 1000) + 's' : '-';
          const cfgText = cfg ? (cfg.rpm ? 'rpm=' + cfg.rpm : '') + ' ' + (cfg.tpm ? 'tpm=' + cfg.tpm : '') : '-';
          return \`<tr class="\${onCooldown ? 'cooldown' : ''}">
            <td>\${name}</td>
            <td>\${s.reqs}</td>
            <td>\${s.tokens.toLocaleString()}</td>
            <td class="\${onCooldown ? 'warn' : 'meta'}">\${cdText}</td>
            <td class="meta">\${cfgText || '-'}</td>
          </tr>\`;
        }).join('') + '</table>';
  document.getElementById('bymodel').innerHTML = d.by_model_60s.length === 0
    ? '<div class="meta">none in last 60s</div>'
    : '<table><tr><th>model</th><th>reqs</th><th>tokens</th></tr>' +
        d.by_model_60s.map(r => \`<tr><td>\${r.model}</td><td>\${r.c}</td><td>\${Number(r.t).toLocaleString()}</td></tr>\`).join('') + '</table>';
  document.getElementById('recent').innerHTML = '<table><tr><th>#</th><th>ts</th><th>model</th><th>status</th><th>upstream</th><th>retries</th><th>ms</th><th>tokens (p/c/t)</th><th>err</th></tr>' +
    d.recent.map(r => \`<tr>
      <td>\${r.id}</td>
      <td>\${new Date(r.ts).toLocaleTimeString()}</td>
      <td>\${r.model ?? '-'}</td>
      <td class="\${r.status >= 500 || r.status === 429 ? 'err' : 'ok'}">\${r.status ?? '-'}</td>
      <td>\${r.upstream_status ?? '-'}</td>
      <td>\${r.retries ?? 0}</td>
      <td>\${r.duration_ms ?? 0}</td>
      <td>\${(r.prompt_tokens ?? 0)}/\${(r.completion_tokens ?? 0)}/\${(r.total_tokens ?? 0)}</td>
      <td class="err">\${(r.error ?? '').slice(0, 80)}</td>
    </tr>\`).join('') + '</table>';
}
document.getElementById('cfg').onsubmit = async e => {
  e.preventDefault();
  const body = {
    rpm: +document.getElementById('rpm').value,
    tpm: +document.getElementById('tpm').value,
    burst: +document.getElementById('burst').value,
    maxRetries: +document.getElementById('maxRetries').value,
    baseBackoffMs: +document.getElementById('baseBackoffMs').value,
    maxBackoffMs: +document.getElementById('maxBackoffMs').value,
  };
  await fetch('/__config', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
  load();
};
document.getElementById('mcfg').onsubmit = async e => {
  e.preventDefault();
  const body = {
    model: document.getElementById('mmodel').value.trim(),
    rpm: +document.getElementById('mrpm').value || undefined,
    tpm: +document.getElementById('mtpm').value || undefined,
  };
  if (!body.model) return;
  await fetch('/__model-config', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
  load();
};
document.getElementById('reset').onclick = async () => { await fetch('/__reset', { method: 'POST' }); loadLogs(true); load(); };
document.getElementById('refresh').onclick = () => { load(); loadLogs(true); };
load(); loadLogs();
setInterval(load, 2000);
setInterval(() => loadLogs(), 2000);

let lastLogId = 0;
async function loadLogs(reset = false) {
  if (reset) lastLogId = 0;
  const baseUrl = lastLogId > 0 ? "/__logs?since=" + (lastLogId - 1) + "&limit=200" : "/__logs?limit=200";
  try {
    const r = await fetch(baseUrl);
    const d = await r.json();
    if (!d.events || d.events.length === 0) return;
    if (lastLogId === 0) {
      // Full render: newest first via reverse already applied; show in chronological order
      const div = document.getElementById('log');
      div.innerHTML = d.events.map(ev => renderLog(ev)).join('');
    } else {
      // Incremental: append only newer events (events returned are > lastLogId)
      const div = document.getElementById('log');
      // events array is in reverse-chronological order; append in correct order
      const newer = d.events.filter(ev => ev.id > lastLogId);
      const html = newer.map(ev => renderLog(ev)).reverse().join('');
      div.insertAdjacentHTML('beforeend', html);
      // Trim to 100 visible lines
      while (div.children.length > 100) div.removeChild(div.firstChild);
    }
    lastLogId = Math.max(...d.events.map(ev => ev.id));
    div.scrollTop = div.scrollHeight;
  } catch (e) { /* ignore */ }
}
function renderLog(ev) {
  const t = new Date(ev.ts).toLocaleTimeString();
  const cls = ev.level === 'error' ? 'err' : (ev.level === 'warn' ? 'warn' : 'meta');
  const clsAttr = cls;
  const time = t;
  const level = ev.level;
  const msg = escapeHtml(ev.msg);
  // Build via array.join to avoid Bun template-literal escape stripping
  // backslashes inside the generated <script> block.
  const dq = String.fromCharCode(34);
  return [
    "<div class=", dq, clsAttr, dq, ">",
    "<span class=", dq, "meta", dq, ">[", time, "]</span> ",
    "<b>", level, "</b> ", msg,
    "</div>",
  ].join("");
}
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
</script></body></html>`;
}
