import { z } from "zod"

const ARTIFACTS_PORT = parseInt(process.env.ARTIFACTS_PORT || "26316", 10)
const ARTIFACTS_DIR = "artifacts"

let serverUrl = ""
let server: any = null
let serverStarted = false

function startServer() {
  if (serverStarted) return
  serverStarted = true

  try {
    const http = require("node:http")
    const fs = require("node:fs")
    const nodePath = require("node:path")

    const mimeTypes: Record<string, string> = {
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
    }

    server = http.createServer(async (req: any, res: any) => {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders)
        res.end()
        return
      }

      const root = nodePath.join(process.cwd(), ARTIFACTS_DIR)
      let urlPath = req.url?.split("?")[0] || "/"
      urlPath = decodeURIComponent(urlPath)

      // ── DELETE endpoint ───────────────────────────────────────────────
      // URL: DELETE /<name>.html  → xoá file + meta
      if (req.method === "DELETE") {
        const target = urlPath.replace(/^\/+/, "")
        if (!target) {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders })
          res.end(JSON.stringify({ ok: false, error: "Missing artifact name" }))
          return
        }
        // Chỉ chấp nhận tên an toàn: kebab-case + .html
        const safeName = target.replace(/[^a-zA-Z0-9.-]/g, "-")
        if (!safeName.endsWith(".html")) {
          res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders })
          res.end(JSON.stringify({ ok: false, error: "Only .html artifacts can be deleted via HTTP" }))
          return
        }
        const filePath = nodePath.join(root, safeName)
        if (!filePath.startsWith(root)) {
          res.writeHead(403, { "Content-Type": "application/json", ...corsHeaders })
          res.end(JSON.stringify({ ok: false, error: "Forbidden" }))
          return
        }
        const baseName = safeName.replace(/\.html$/, "")
        const metaPath = nodePath.join(root, `${baseName}.meta.json`)
        const deleted: string[] = []
        try { await fs.promises.unlink(filePath); deleted.push(safeName) } catch {}
        try { await fs.promises.unlink(metaPath); deleted.push(`${baseName}.meta.json`) } catch {}
        if (deleted.length === 0) {
          res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders })
          res.end(JSON.stringify({ ok: false, error: "Artifact not found", name: safeName }))
          return
        }
        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders })
        res.end(JSON.stringify({ ok: true, deleted, name: safeName }))
        return
      }

      if (urlPath === "/") {
        fs.readdir(root, { withFileTypes: true }, (err: any, entries: any[]) => {
          if (err) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...corsHeaders })
            res.end("<html><body><h1>Artifacts Server</h1><p>No artifacts yet.</p></body></html>")
            return
          }
          const files = entries.filter(e => e.isFile()).map(e => e.name).sort()
          const links = files.map(f =>
            `<li><a href="/${encodeURIComponent(f)}">${f}</a></li>`
          ).join("\n")
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...corsHeaders })
          res.end(`<html><body><h1>📦 Artifacts</h1><ul>${links}</ul></body></html>`)
        })
        return
      }

      const safePath = nodePath.resolve(root, "." + urlPath)
      if (!safePath.startsWith(root)) {
        res.writeHead(403, { ...corsHeaders })
        res.end("Forbidden")
        return
      }

      const ext = nodePath.extname(safePath).toLowerCase()
      const contentType = mimeTypes[ext] || "application/octet-stream"

      fs.readFile(safePath, (err: any, data: Buffer) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", ...corsHeaders })
          res.end(`<html><body><h1>404</h1><p>Artifact not found</p></body></html>`)
          return
        }
        res.writeHead(200, { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" })
        res.end(data)
      })
    })

    server.listen(ARTIFACTS_PORT, "127.0.0.1", () => {
      serverUrl = `http://127.0.0.1:${ARTIFACTS_PORT}`
    })

    server.on("error", () => {
      serverUrl = ""
    })
  } catch {
    serverUrl = ""
  }
}

function stopServer() {
  if (!serverStarted || !server) return "Server is not running."
  try {
    server.close()
    server = null
    serverStarted = false
    serverUrl = ""
    return `Server stopped (http://127.0.0.1:${ARTIFACTS_PORT})`
  } catch {
    return "Failed to stop server."
  }
}

function serverStatus() {
  if (serverStarted && server) {
    return `Server is running at http://127.0.0.1:${ARTIFACTS_PORT}`
  }
  return "Server is not running."
}

export default async () => {
  startServer()

  return {
    "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
      const url = serverUrl || `http://127.0.0.1:${ARTIFACTS_PORT}`
      output.system.push(`You have access to artifact management tools: publish_artifact, list_artifacts, delete_artifact, artifact_info, start_artifact_server, stop_artifact_server, artifact_server_status.

Use publish_artifact to create rich HTML pages that appear as live previews in the artifact panel — dashboards, news digests, reports, annotated diffs, design comparisons, or any output better viewed as a web page than terminal text.

When publishing, include a "prompt" describing how to regenerate the artifact (e.g. "Fetch latest news from VnExpress RSS, format as HTML"). This prompt is stored and used by /antifact update to know what to do.

Publishing with the same title overwrites the existing artifact (live update). Each update is tracked in history with timestamp. After publishing, mention the file path (e.g. "artifacts/daily-news.html") in your response so the artifact panel detects it. The artifact is also served at ${url}/<filename>.

Use list_artifacts to see all published artifacts with URLs.
Use delete_artifact to remove an artifact by title.
Use artifact_info to show details about a specific artifact.
Use artifact_prompt to read or update the regeneration prompt for an artifact.
Use start_artifact_server / stop_artifact_server to control the HTTP server.
Use artifact_server_status to check if the server is running.

The /antifact command activates the antifact skill for interactive management.`)
    },
    tool: {
      publish_artifact: {
        description: "Create or update an HTML artifact page. The artifact appears in the artifact panel and can be viewed in the built-in browser. Use for dashboards, news digests, reports, annotated diffs, or any rich HTML output.",
        args: z.object({
          title: z.string().describe("Artifact title (used as filename, e.g. 'daily-news'). Use kebab-case."),
          content: z.string().describe("Full HTML content. Must include <!DOCTYPE html>, <html>, <head>, and <body> tags."),
          prompt: z.string().optional().describe("Optional prompt describing how to regenerate this artifact (e.g. 'Fetch latest news from VnExpress RSS, format as HTML'). Used by /antifact update."),
        }).shape,
        async execute(args: { title: string; content: string; prompt?: string }) {
          const fs = await import("node:fs/promises")
          const nodePath = await import("node:path")

          const safeName = args.title.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
          const dir = nodePath.join(process.cwd(), ARTIFACTS_DIR)
          const metaPath = nodePath.join(dir, `${safeName}.meta.json`)
          const filePath = nodePath.join(dir, `${safeName}.html`)

          await fs.mkdir(dir, { recursive: true })

          let existingMeta: Record<string, unknown> = {}
          try {
            existingMeta = JSON.parse(await fs.readFile(metaPath, "utf-8"))
          } catch {}

          const now = new Date().toISOString()
          const size = Buffer.byteLength(args.content, "utf-8")
          const oldSize = existingMeta.lastSize as number | undefined

          const history = (existingMeta.history as Array<Record<string, unknown>>) || []
          history.push({
            timestamp: now,
            size,
            summary: args.prompt
              ? `Regenerated via prompt: ${args.prompt.slice(0, 80)}`
              : oldSize !== undefined && oldSize !== size
                ? `Updated (${((size - oldSize) / 1024).toFixed(1)} KB change)`
                : "Updated",
          })

          await fs.writeFile(filePath, args.content, "utf-8")

          const meta: Record<string, unknown> = {
            prompt: args.prompt ?? existingMeta.prompt ?? "",
            lastRunAt: now,
            createdAt: existingMeta.createdAt || now,
            lastSize: size,
            history: history.slice(-20),
          }
          await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8")

          const relativePath = `artifacts/${safeName}.html`
          const url = serverUrl ? `${serverUrl}/${encodeURIComponent(safeName)}.html` : relativePath

          return {
            output: `Published artifact: ${relativePath}\nURL: ${url}`,
            metadata: {
              path: relativePath,
              url,
              title: args.title,
              lastRunAt: now,
              totalUpdates: history.length,
            },
          }
        },
      },
      list_artifacts: {
        description: "List all published HTML artifacts in the artifacts/ directory.",
        args: {},
        async execute() {
          const fs = await import("node:fs/promises")
          const nodePath = await import("node:path")

          const dir = nodePath.join(process.cwd(), ARTIFACTS_DIR)
          try {
            const files = await fs.readdir(dir)
            const htmlFiles = files.filter(f => f.endsWith(".html")).sort()
            if (htmlFiles.length === 0) return "No artifacts published yet."
            const details = await Promise.all(
              htmlFiles.map(async (f) => {
                const stat = await fs.stat(nodePath.join(dir, f))
                const url = serverUrl ? `${serverUrl}/${encodeURIComponent(f)}` : ""
                const name = f.replace(/\.html$/, "")
                let lastRun = ""
                let updates = 0
                try {
                  const meta = JSON.parse(await fs.readFile(nodePath.join(dir, `${name}.meta.json`), "utf-8"))
                  lastRun = meta.lastRunAt ? new Date(meta.lastRunAt).toLocaleString() : ""
                  updates = (meta.history || []).length
                } catch {}
                const updatesStr = updates > 0 ? ` (${updates} updates)` : ""
                const lastRunStr = lastRun ? `, last: ${lastRun}` : ""
                const urlStr = url ? ` → ${url}` : ""
                return `  ${f}${updatesStr}${lastRunStr} (${(stat.size / 1024).toFixed(1)} KB)${urlStr}`
              }),
            )
            return `Published artifacts:\n${details.join("\n")}`
          } catch {
            return "No artifacts published yet."
          }
        },
      },
      delete_artifact: {
        description: "Delete an artifact by title. Removes the file from the server.",
        args: z.object({
          title: z.string().describe("Artifact title to delete (e.g. 'daily-news')."),
        }).shape,
        async execute(args: { title: string }) {
          const fs = await import("node:fs/promises")
          const nodePath = await import("node:path")

          const safeName = args.title.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
          const dir = nodePath.join(process.cwd(), ARTIFACTS_DIR)
          const filePath = nodePath.join(dir, `${safeName}.html`)
          const metaPath = nodePath.join(dir, `${safeName}.meta.json`)

          let deleted = ""
          try { await fs.unlink(filePath); deleted += `${safeName}.html ` } catch {}
          try { await fs.unlink(metaPath); deleted += `${safeName}.meta.json ` } catch {}
          return deleted ? `Deleted: ${deleted}` : `Artifact not found: ${safeName}`
        },
      },
      artifact_info: {
        description: "Show details about a specific artifact: URL, size, last modified, content preview.",
        args: z.object({
          title: z.string().describe("Artifact title (e.g. 'daily-news')."),
        }).shape,
        async execute(args: { title: string }) {
          const fs = await import("node:fs/promises")
          const nodePath = await import("node:path")

          const safeName = args.title.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
          const dir = nodePath.join(process.cwd(), ARTIFACTS_DIR)
          const filePath = nodePath.join(dir, `${safeName}.html`)
          const metaPath = nodePath.join(dir, `${safeName}.meta.json`)

          try {
            const stat = await fs.stat(filePath)
            const content = await fs.readFile(filePath, "utf-8")
            const titleMatch = content.match(/<title>([^<]+)<\/title>/i)
            const titleName = titleMatch ? titleMatch[1] : safeName
            const preview = content.replace(/<[^>]+>/g, "").trim().slice(0, 200)
            const url = serverUrl ? `${serverUrl}/${encodeURIComponent(safeName)}.html` : "N/A"

            let prompt = ""
            let lastRunAt = ""
            let createdAt = ""
            let history: Array<Record<string, unknown>> = []
            try {
              const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"))
              prompt = meta.prompt || ""
              lastRunAt = meta.lastRunAt || ""
              createdAt = meta.createdAt || ""
              history = meta.history || []
            } catch {}

            const lines = [
              `Title: ${titleName}`,
              `File: ${safeName}.html`,
              `URL: ${url}`,
              `Size: ${(stat.size / 1024).toFixed(1)} KB`,
              `Created: ${createdAt ? new Date(createdAt).toLocaleString() : "N/A"}`,
              `Last run: ${lastRunAt ? new Date(lastRunAt).toLocaleString() : "N/A"}`,
              `Updates: ${history.length}`,
            ]
            if (prompt) {
              lines.push(`Prompt: ${prompt}`)
            }
            lines.push(`Preview: ${preview}...`)

            if (history.length > 0) {
              lines.push("")
              lines.push("── History ──")
              for (const entry of history.slice(-5)) {
                const t = entry.timestamp ? new Date(entry.timestamp as string).toLocaleString() : "?"
                const s = entry.summary || ""
                lines.push(`  ${t} — ${s}`)
              }
            }

            return lines.join("\n")
          } catch {
            return `Artifact not found: ${safeName}`
          }
        },
      },
      artifact_prompt: {
        description: "Read or update the regeneration prompt for an artifact. The prompt tells the agent what to do when updating.",
        args: z.object({
          title: z.string().describe("Artifact title (e.g. 'daily-news')."),
          prompt: z.string().optional().describe("New prompt to set. Omit to read the current prompt."),
        }).shape,
        async execute(args: { title: string; prompt?: string }) {
          const fs = await import("node:fs/promises")
          const nodePath = await import("node:path")

          const safeName = args.title.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
          const dir = nodePath.join(process.cwd(), ARTIFACTS_DIR)
          const metaPath = nodePath.join(dir, `${safeName}.meta.json`)

          if (args.prompt !== undefined) {
            let existingMeta: Record<string, unknown> = {}
            try {
              existingMeta = JSON.parse(await fs.readFile(metaPath, "utf-8"))
            } catch {}
            existingMeta.prompt = args.prompt
            const history = (existingMeta.history as Array<Record<string, unknown>>) || []
            history.push({
              timestamp: new Date().toISOString(),
              summary: `Prompt updated: ${args.prompt.slice(0, 80)}`,
            })
            existingMeta.history = history.slice(-20)
            await fs.writeFile(metaPath, JSON.stringify(existingMeta, null, 2), "utf-8")
            return `Prompt updated for "${safeName}":\n${args.prompt}`
          }

          try {
            const raw = await fs.readFile(metaPath, "utf-8")
            const meta = JSON.parse(raw)
            return meta.prompt
              ? `Prompt for "${safeName}":\n${meta.prompt}`
              : `No prompt saved for "${safeName}".`
          } catch {
            return `No prompt saved for "${safeName}".`
          }
        },
      },
      start_artifact_server: {
        description: "Start the artifact HTTP server if it's not running.",
        args: {},
        async execute() {
          if (serverStarted && server) {
            return `Server is already running at http://127.0.0.1:${ARTIFACTS_PORT}`
          }
          startServer()
          return `Server started at http://127.0.0.1:${ARTIFACTS_PORT}`
        },
      },
      stop_artifact_server: {
        description: "Stop the artifact HTTP server.",
        args: {},
        async execute() {
          return stopServer()
        },
      },
      artifact_server_status: {
        description: "Check if the artifact HTTP server is running.",
        args: {},
        async execute() {
          return serverStatus()
        },
      },
    },
  }
}