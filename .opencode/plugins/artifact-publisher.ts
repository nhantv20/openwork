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

    server = http.createServer((req: any, res: any) => {
      const root = nodePath.join(process.cwd(), ARTIFACTS_DIR)
      let urlPath = req.url?.split("?")[0] || "/"
      urlPath = decodeURIComponent(urlPath)

      if (urlPath === "/") {
        fs.readdir(root, { withFileTypes: true }, (err: any, entries: any[]) => {
          if (err) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
            res.end("<html><body><h1>Artifacts Server</h1><p>No artifacts yet.</p></body></html>")
            return
          }
          const files = entries.filter(e => e.isFile()).map(e => e.name).sort()
          const links = files.map(f =>
            `<li><a href="/${encodeURIComponent(f)}">${f}</a></li>`
          ).join("\n")
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          res.end(`<html><body><h1>📦 Artifacts</h1><ul>${links}</ul></body></html>`)
        })
        return
      }

      const safePath = nodePath.resolve(root, "." + urlPath)
      if (!safePath.startsWith(root)) {
        res.writeHead(403)
        res.end("Forbidden")
        return
      }

      const ext = nodePath.extname(safePath).toLowerCase()
      const contentType = mimeTypes[ext] || "application/octet-stream"

      fs.readFile(safePath, (err: any, data: Buffer) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" })
          res.end(`<html><body><h1>404</h1><p>Artifact not found</p></body></html>`)
          return
        }
        res.writeHead(200, { "Content-Type": contentType })
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

Publishing with the same title overwrites the existing artifact (live update). After publishing, mention the file path (e.g. "artifacts/daily-news.html") in your response so the artifact panel detects it. The artifact is also served at ${url}/<filename>.

Use list_artifacts to see all published artifacts with URLs.
Use delete_artifact to remove an artifact by title.
Use artifact_info to show details about a specific artifact.
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
        }).shape,
        async execute(args: { title: string; content: string }) {
          const fs = await import("node:fs/promises")
          const nodePath = await import("node:path")

          const safeName = args.title.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
          const dir = nodePath.join(process.cwd(), ARTIFACTS_DIR)
          const filePath = nodePath.join(dir, `${safeName}.html`)

          await fs.mkdir(dir, { recursive: true })
          await fs.writeFile(filePath, args.content, "utf-8")

          const relativePath = `artifacts/${safeName}.html`
          const url = serverUrl ? `${serverUrl}/${encodeURIComponent(safeName)}.html` : relativePath

          return {
            output: `Published artifact: ${relativePath}\nURL: ${url}`,
            metadata: {
              path: relativePath,
              url,
              title: args.title,
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
                const urlStr = url ? ` → ${url}` : ""
                return `  ${f} (${(stat.size / 1024).toFixed(1)} KB, ${new Date(stat.mtimeMs).toISOString().slice(0, 16).replace("T", " ")})${urlStr}`
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

          try {
            await fs.unlink(filePath)
            return `Deleted artifact: ${safeName}.html`
          } catch {
            return `Artifact not found: ${safeName}.html`
          }
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

          try {
            const stat = await fs.stat(filePath)
            const content = await fs.readFile(filePath, "utf-8")
            const titleMatch = content.match(/<title>([^<]+)<\/title>/i)
            const title = titleMatch ? titleMatch[1] : safeName
            const preview = content.replace(/<[^>]+>/g, "").trim().slice(0, 200)
            const url = serverUrl ? `${serverUrl}/${encodeURIComponent(safeName)}.html` : "N/A"

            return [
              `Title: ${title}`,
              `File: ${safeName}.html`,
              `URL: ${url}`,
              `Size: ${(stat.size / 1024).toFixed(1)} KB`,
              `Modified: ${new Date(stat.mtimeMs).toLocaleString()}`,
              `Preview: ${preview}...`,
            ].join("\n")
          } catch {
            return `Artifact not found: ${safeName}.html`
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