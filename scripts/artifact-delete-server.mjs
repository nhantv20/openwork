/**
 * Standalone artifact server with DELETE support.
 * Serves /artifacts/*.html on http://127.0.0.1:26318 and accepts
 * DELETE /<name>.html to remove the file (plus its .meta.json).
 *
 * This complements the read-only artifact server on :26316 by
 * letting any in-page "Delete" button actually remove its file.
 *
 * Usage:  node scripts/artifact-delete-server.mjs
 * Endpoints:
 *   GET    /                  → list artifacts
 *   GET    /<name>.html       → serve file
 *   DELETE /<name>.html       → remove file + .meta.json (returns JSON)
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PORT = parseInt(process.env.ARTIFACT_DELETE_PORT || "26318", 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try several candidate locations because the artifact publisher plugin
// runs inside the opencode sidecar process which has its own cwd
// (managed-opencode-workdir), while this script runs in the workspace cwd.
//
// Strategy:
//   1. Prefer a candidate that *currently contains any .html file* matching
//      what's served by the artifact publisher on :26316 — that's the live
//      directory the browser actually fetches from.
//   2. Fall back to the first writable candidate.
function findArtifactsDir() {
  const candidates = [
    process.env.ARTIFACTS_DIR,
    "/Users/trannhan/Library/Application Support/com.differentai.openwork.dev/managed-opencode-workdir/artifacts",
    path.resolve(os.homedir(), "Library/Application Support/com.differentai.openwork.dev/managed-opencode-workdir/artifacts"),
    path.resolve(process.cwd(), "artifacts"),
    path.resolve(__dirname, "..", "artifacts"),
  ].filter(Boolean);

  // 1. Pick the dir that contains at least one .html file and is writable.
  for (const c of candidates) {
    try {
      if (fs.accessSync && fs.readdirSync(c).some((f) => f.endsWith(".html"))) {
        fs.accessSync(c, fs.constants.W_OK);
        return c;
      }
    } catch {}
  }
  // 2. Otherwise, first writable dir (create if missing).
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.R_OK | fs.constants.W_OK); return c; } catch {}
  }
  const fallback = path.resolve(__dirname, "..", "artifacts");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

const ARTIFACTS_DIR = findArtifactsDir();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function send(res, status, body, contentType = "application/json") {
  res.writeHead(status, { "Content-Type": contentType, ...corsHeaders });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

  // ── DELETE ─────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const target = urlPath.replace(/^\/+/, "");
    if (!target) return send(res, 400, { ok: false, error: "Missing artifact name" });

    const safeName = target.replace(/[^a-zA-Z0-9.-]/g, "-");
    if (!safeName.endsWith(".html")) {
      return send(res, 400, { ok: false, error: "Only .html artifacts can be deleted via HTTP" });
    }

    const filePath = path.join(ARTIFACTS_DIR, safeName);
    if (!filePath.startsWith(ARTIFACTS_DIR)) {
      return send(res, 403, { ok: false, error: "Forbidden" });
    }

    const baseName = safeName.replace(/\.html$/, "");
    const metaPath = path.join(ARTIFACTS_DIR, `${baseName}.meta.json`);

    const deleted = [];
    try { await fsp.unlink(filePath); deleted.push(safeName); } catch {}
    try { await fsp.unlink(metaPath); deleted.push(`${baseName}.meta.json`); } catch {}

    if (deleted.length === 0) {
      return send(res, 404, { ok: false, error: "Artifact not found", name: safeName });
    }
    return send(res, 200, { ok: true, deleted, name: safeName });
  }

  // ── GET / ──────────────────────────────────────────────────────────
  if (urlPath === "/") {
    try {
      const entries = await fsp.readdir(ARTIFACTS_DIR);
      const htmls = entries.filter((f) => f.endsWith(".html")).sort();
      return send(res, 200, {
        ok: true,
        count: htmls.length,
        artifacts: htmls.map((f) => ({
          name: f,
          url: `http://127.0.0.1:${PORT}/${encodeURIComponent(f)}`,
        })),
      });
    } catch {
      return send(res, 200, { ok: true, count: 0, artifacts: [] });
    }
  }

  // ── GET /<file> ────────────────────────────────────────────────────
  if (req.method === "GET" || req.method === "HEAD") {
    const safePath = path.resolve(ARTIFACTS_DIR, "." + urlPath);
    if (!safePath.startsWith(ARTIFACTS_DIR)) {
      return send(res, 403, { ok: false, error: "Forbidden" }, "text/plain");
    }
    const ext = path.extname(safePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";

    try {
      const data = await fsp.readFile(safePath);
      res.writeHead(200, { "Content-Type": contentType, ...corsHeaders });
      if (req.method === "HEAD") res.end();
      else res.end(data);
    } catch {
      return send(res, 404, { ok: false, error: "Artifact not found" }, "text/plain");
    }
    return;
  }

  send(res, 405, { ok: false, error: `Method ${req.method} not allowed` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`🗑️  Artifact delete server: http://127.0.0.1:${PORT}`);
  console.log(`    DELETE /<name>.html   → remove artifact + meta`);
  console.log(`    Serving from: ${ARTIFACTS_DIR}`);
});

process.on("SIGINT", () => { server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
