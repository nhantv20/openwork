/**
 * CORS proxy for the artifact server (port 26316).
 * Serves artifacts with Access-Control-Allow-Origin: * headers
 * so the OpenWork app (localhost:5173) can fetch them.
 *
 * Usage: node scripts/artifact-cors-proxy.mjs
 * Proxies: 127.0.0.1:26316 → 127.0.0.1:26317
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_PORT = parseInt(process.env.ARTIFACT_SERVER_PORT || "26316", 10);
const PROXY_PORT = parseInt(process.env.CORS_PROXY_PORT || "26317", 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(__dirname, "..", "artifacts");

const proxy = http.createServer((req, res) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const options = {
    hostname: "127.0.0.1",
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${TARGET_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers, ...corsHeaders };
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    // Fallback: serve directly from disk if target server is down
    const root = ARTIFACTS_DIR;
    let urlPath = req.url?.split("?")[0] || "/";
    urlPath = decodeURIComponent(urlPath);

    if (urlPath === "/") {
      fs.readdir(root, { withFileTypes: true }, (err, entries) => {
        if (err) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...corsHeaders });
          res.end("<html><body><h1>📦 Artifacts</h1><p>No artifacts yet.</p></body></html>");
          return;
        }
        const files = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
        const links = files.map((f) => `<li><a href="/${encodeURIComponent(f)}">${f}</a></li>`).join("\n");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...corsHeaders });
        res.end(`<html><body><h1>📦 Artifacts</h1><ul>${links}</ul></body></html>`);
      });
      return;
    }

    const safePath = path.resolve(root, "." + urlPath);
    if (!safePath.startsWith(root)) {
      res.writeHead(403, corsHeaders);
      res.end("Forbidden");
      return;
    }

    fs.readFile(safePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", ...corsHeaders });
        res.end("<html><body><h1>404</h1><p>Not found</p></body></html>");
        return;
      }
      const ext = path.extname(safePath).toLowerCase();
      const mimeTypes = {
        ".html": "text/html; charset=utf-8",
        ".htm": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".md": "text/markdown; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".pdf": "application/pdf",
        ".csv": "text/csv; charset=utf-8",
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream", ...corsHeaders });
      res.end(data);
    });
  });

  req.pipe(proxyReq);
});

proxy.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`✅ CORS proxy running at http://127.0.0.1:${PROXY_PORT}`);
  console.log(`   Proxying → http://127.0.0.1:${TARGET_PORT}`);
  console.log(`   Fallback dir: ${ARTIFACTS_DIR}`);
});
