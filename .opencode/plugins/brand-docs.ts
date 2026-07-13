import { z } from "zod"
import * as fs from "node:fs"
import * as path from "node:path"

// ── Paths ──────────────────────────────────────────────────
const BRAND_DOCS_ROOT = "/Users/trannhan/project/brand-docs"
const VENV_PYTHON = `${BRAND_DOCS_ROOT}/.venv/bin/python3`
const BD_CLI = `${BRAND_DOCS_ROOT}/scripts/cli.py`
const WORKSPACE = process.cwd()

// ── Helpers ────────────────────────────────────────────────
function runBrandDocs(args: string[]): string {
  const { execSync } = require("node:child_process")
  const cmd = `${VENV_PYTHON} ${BD_CLI} ${args.map(a => JSON.stringify(a)).join(" ")}`
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 120_000, env: { ...process.env, BRAND_DOCS_ROOT } }).trim()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`brand-docs CLI failed: ${message}`)
  }
}

function runOfficeCLI(args: string[]): string {
  const { execSync } = require("node:child_process")
  const cmd = `officecli ${args.map(a => JSON.stringify(a)).join(" ")}`
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 60_000 }).trim()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`officecli failed: ${message}`)
  }
}

function runOfficeCLIJson(args: string[]): Record<string, unknown> {
  const { execSync } = require("node:child_process")
  const cmd = `officecli ${args.map(a => JSON.stringify(a)).join(" ")} --json`
  try {
    return JSON.parse(execSync(cmd, { encoding: "utf-8", timeout: 60_000 }).trim())
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`officecli failed: ${message}`)
  }
}

function findBrandKit(name: string): string | null {
  const candidates = [
    path.join(WORKSPACE, "brand-kit", name),
    path.join(WORKSPACE, "..", "brand-kit", name),
    path.join(BRAND_DOCS_ROOT, "brand-kit", name),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "profile.json"))) return dir
  }
  return null
}

function readBrandProfile(name: string): Record<string, unknown> | null {
  const kit = findBrandKit(name)
  if (!kit) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(kit, "profile.json"), "utf-8"))
  } catch { return null }
}

export default async () => ({
  "experimental.chat.system.transform": async (
    _input: unknown,
    output: { system: string[] },
  ) => {
    output.system.push(
      "You have a COMBINED Office document system: BrandDocs + OfficeCLI.\n" +
      "\n" +
      "**Workflow khi có template công ty:**\n" +
      "  1. `brand_docs_extract` — học brand từ template (màu, font, style) → lưu vào brand-kit/<name>/\n" +
      "  2. `officecli_create_from_brand` — copy template shell + mở bằng OfficeCLI để edit\n" +
      "  3. Dùng `officecli_add`, `officecli_set`, `officecli_remove` để thêm nội dung\n" +
      "  4. `officecli_view html/screenshot` — xem trước, visual QA\n" +
      "  5. `officecli_merge` — điền {{key}} hàng loạt (nếu cần)\n" +
      "\n" +
      "**Workflow khi KHÔNG có template (tạo từ đầu):**\n" +
      "  - `officecli_create` → `officecli_add` → `officecli_view`\n" +
      "\n" +
      "BrandDocs skills: .opencode/skills/brand-{docx,pptx,xlsx}/",
    )
  },
  tool: {
    // ═══════════════════════════════════════════════════════
    // BRANDDOCS — học brand từ template
    // ═══════════════════════════════════════════════════════
    brand_docs_doctor: {
      description:
        "Check BrandDocs engine readiness. Run this first before any brand-docs operation.",
      args: {},
      async execute() {
        return runBrandDocs(["doctor"])
      },
    },
    brand_docs_extract: {
      description:
        "Extract a brand profile from a company Office template (.docx, .pptx, .xlsx). " +
        "Saves brand-kit/<name>/ with profile.json (colors, fonts, styles) + template/shell.docx (template gốc). " +
        "Sau đó có thể dùng officecli_create_from_brand để tạo document từ brand này.",
      args: z.object({
        name: z.string().describe("Brand name (used as folder name in brand-kit/)"),
        template: z.string().describe("Path to the company template file (.docx, .pptx, .xlsx)"),
      }).shape,
      async execute(args: { name: string; template: string }) {
        return runBrandDocs(["extract", "--name", args.name, "--template", args.template, "--scope", "project"])
      },
    },
    brand_docs_verify: {
      description:
        "Verify a saved Brand Profile. Checks that all roles point at real template artifacts.",
      args: z.object({
        name: z.string().describe("Brand name (must exist in brand-kit/<name>/)"),
      }).shape,
      async execute(args: { name: string }) {
        return runBrandDocs(["verify", "--name", args.name, "--scope", "auto", "--qa", "auto"])
      },
    },
    brand_docs_generate: {
      description:
        "Generate a new on-brand Office document from an IntermediateDocument (JSON) and a saved Brand Profile. " +
        "Output is a .docx, .pptx, or .xlsx file depending on the source template format.",
      args: z.object({
        name: z.string().describe("Brand name (must exist in brand-kit/<name>/)"),
        input: z.string().describe("Path to IntermediateDocument JSON file"),
        output: z.string().describe("Path for the output document (e.g. report.docx, deck.pptx, workbook.xlsx)"),
      }).shape,
      async execute(args: { name: string; input: string; output: string }) {
        return runBrandDocs(["generate", "--name", args.name, "--input", args.input, "--output", args.output, "--scope", "auto", "--qa", "auto"])
      },
    },
    brand_read_profile: {
      description:
        "Read a saved Brand Profile and return its colors, fonts, styles, and structure. " +
        "Use this to know what brand values (theme colors, font families, style names) to apply " +
        "when using OfficeCLI to create or edit documents for this brand.",
      args: z.object({
        name: z.string().describe("Brand name (must exist in brand-kit/<name>/)"),
      }).shape,
      async execute(args: { name: string }) {
        const profile = readBrandProfile(args.name)
        if (!profile) throw new Error(`Brand "${args.name}" not found. Run brand_docs_extract first.`)

        // Extract key brand info
        const result: Record<string, unknown> = {
          brand: args.name,
          kind: profile.kind || profile.document_type || "unknown",
          theme: profile.theme || {},
          palette: profile.palette || {},
          fonts: profile.fonts || {},
          styles: Object.keys((profile as Record<string, unknown>).styles || {}).slice(0, 50),
          roles: (profile as Record<string, unknown>).roles || {},
        }
        return JSON.stringify(result, null, 2)
      },
    },

    // ═══════════════════════════════════════════════════════
    // KẾT HỢP: Brand + OfficeCLI
    // ═══════════════════════════════════════════════════════
    officecli_create_from_brand: {
      description:
        "Create a new Office document from a saved brand's template shell. " +
        "Copies the brand's template (with all colors, fonts, styles preserved) and opens it " +
        "with OfficeCLI so you can add/edit content freely. " +
        "Kết hợp BrandDocs (giữ brand) + OfficeCLI (linh hoạt edit).",
      args: z.object({
        brand: z.string().describe("Brand name (must have been extracted via brand_docs_extract)"),
        output: z.string().describe("Output path for the new document (e.g. report.docx, deck.pptx)"),
      }).shape,
      async execute(args: { brand: string; output: string }) {
        const kit = findBrandKit(args.brand)
        if (!kit) throw new Error(`Brand "${args.brand}" not found. Run brand_docs_extract first.`)

        // Find the shell template
        const templateDir = path.join(kit, "template")
        const files = fs.readdirSync(templateDir)
        const shell = files.find(f => f.startsWith("shell."))
        if (!shell) throw new Error(`No shell template found for brand "${args.brand}".`)

        const shellPath = path.join(templateDir, shell)
        const outPath = path.resolve(args.output)

        // Copy shell to output
        fs.cpSync(shellPath, outPath, { recursive: true })

        // Open with OfficeCLI (resident mode)
        return runOfficeCLI(["open", outPath])
      },
    },
    officecli_merge_brand: {
      description:
        "Template merge using a saved brand's template shell. " +
        "Copies the brand shell, then replaces {{key}} placeholders with JSON data. " +
        "Giữ nguyên brand colors/fonts từ template, chỉ fill nội dung.",
      args: z.object({
        brand: z.string().describe("Brand name (must have been extracted via brand_docs_extract)"),
        output: z.string().describe("Output path for the filled document"),
        data: z.string().describe("JSON data string or path to JSON file for {{key}} placeholder values"),
      }).shape,
      async execute(args: { brand: string; output: string; data: string }) {
        const kit = findBrandKit(args.brand)
        if (!kit) throw new Error(`Brand "${args.brand}" not found. Run brand_docs_extract first.`)

        const templateDir = path.join(kit, "template")
        const files = fs.readdirSync(templateDir)
        const shell = files.find(f => f.startsWith("shell."))
        if (!shell) throw new Error(`No shell template found for brand "${args.brand}".`)

        const shellPath = path.join(templateDir, shell)
        const outPath = path.resolve(args.output)

        // Copy shell then merge
        fs.cpSync(shellPath, outPath, { recursive: true })
        return runOfficeCLI(["merge", outPath, outPath, args.data])
      },
    },

    // ═══════════════════════════════════════════════════════
    // OFFICECLI — tạo từ đầu, edit, xem
    // ═══════════════════════════════════════════════════════
    officecli_create: {
      description:
        "Create a blank Office document (.docx, .xlsx, .pptx) from scratch. " +
        "Type is inferred from file extension. Dùng khi KHÔNG có template brand.",
      args: z.object({
        output: z.string().describe("Path for the new document (e.g. report.docx, deck.pptx, data.xlsx)"),
      }).shape,
      async execute(args: { output: string }) {
        return runOfficeCLI(["create", args.output])
      },
    },
    officecli_view: {
      description:
        "View document content: outline (structure), html (rendered preview), " +
        "screenshot (per-page PNG for visual QA), issues (quality checks).",
      args: z.object({
        file: z.string().describe("Path to the document file"),
        mode: z.enum(["outline", "text", "annotated", "html", "screenshot", "issues", "stats"]).describe("View mode"),
        page: z.number().optional().describe("Page/slide number for screenshot mode"),
        output: z.string().optional().describe("Output path for html/screenshot"),
      }).shape,
      async execute(args: { file: string; mode: string; page?: number; output?: string }) {
        const cmd = ["view", args.file, args.mode]
        if (args.page) cmd.push("--page", String(args.page))
        if (args.output) cmd.push("-o", args.output)
        return runOfficeCLI(cmd)
      },
    },
    officecli_get: {
      description:
        "Get an element and its children from a document by path. Returns structured JSON. " +
        "Example: /slide[1], /body/p[1], /Sheet1.",
      args: z.object({
        file: z.string().describe("Path to the document file"),
        path: z.string().describe("Element path (e.g. /slide[1], /body/p[1], /Sheet1)"),
        depth: z.number().optional().describe("How many levels deep to traverse"),
      }).shape,
      async execute(args: { file: string; path: string; depth?: number }) {
        const cmd = ["get", args.file, args.path, "--json"]
        if (args.depth) cmd.push("--depth", String(args.depth))
        return JSON.stringify(runOfficeCLIJson(cmd), null, 2)
      },
    },
    officecli_set: {
      description:
        "Modify element properties. Common props: text, bold, italic, color, font, size, fill. " +
        "Path examples: /slide[1]/shape[1], /body/p[1]/r[1].",
      args: z.object({
        file: z.string().describe("Path to the document file"),
        path: z.string().describe("Element path (e.g. /slide[1]/shape[1], /body/p[1]/r[1])"),
        props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe("Properties as key-value pairs"),
      }).shape,
      async execute(args: { file: string; path: string; props: Record<string, string | number | boolean> }) {
        const cmd = ["set", args.file, args.path]
        for (const [key, value] of Object.entries(args.props)) {
          cmd.push("--prop", `${key}=${value}`)
        }
        return runOfficeCLI(cmd)
      },
    },
    officecli_add: {
      description:
        "Add an element (slide, shape, sheet, paragraph, table, chart, etc.). " +
        "Use --type and --prop. Example: add slide with title, add shape with text.",
      args: z.object({
        file: z.string().describe("Path to the document file"),
        parent: z.string().describe("Parent path (e.g. / for root, /slide[1] for a slide)"),
        type: z.string().describe("Element type (slide, shape, sheet, paragraph, table, chart, etc.)"),
        props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Properties as key-value pairs"),
      }).shape,
      async execute(args: { file: string; parent: string; type: string; props?: Record<string, string | number | boolean> }) {
        const cmd = ["add", args.file, args.parent, "--type", args.type]
        if (args.props) {
          for (const [key, value] of Object.entries(args.props)) {
            cmd.push("--prop", `${key}=${value}`)
          }
        }
        return runOfficeCLI(cmd)
      },
    },
    officecli_remove: {
      description: "Remove an element from a document by path.",
      args: z.object({
        file: z.string().describe("Path to the document file"),
        path: z.string().describe("Element path to remove"),
      }).shape,
      async execute(args: { file: string; path: string }) {
        return runOfficeCLI(["remove", args.file, args.path])
      },
    },
    officecli_merge: {
      description:
        "Template merge — replace {{key}} placeholders in any .docx/.xlsx/.pptx with JSON data. " +
        "Agent designs layout once; merge fills it N times deterministically.",
      args: z.object({
        template: z.string().describe("Path to the template document with {{key}} placeholders"),
        output: z.string().describe("Output path for the filled document"),
        data: z.string().describe("JSON data string or path to JSON file"),
      }).shape,
      async execute(args: { template: string; output: string; data: string }) {
        return runOfficeCLI(["merge", args.template, args.output, args.data])
      },
    },
    officecli_validate: {
      description: "Validate a document against OpenXML schema. Checks structural integrity.",
      args: z.object({
        file: z.string().describe("Path to the document file"),
      }).shape,
      async execute(args: { file: string }) {
        return runOfficeCLI(["validate", args.file])
      },
    },
    officecli_watch: {
      description:
        "Start live HTML preview at http://localhost:26315. " +
        "Every edit (add/set/remove) updates the browser in real time.",
      args: z.object({
        file: z.string().describe("Path to the document file"),
      }).shape,
      async execute(args: { file: string }) {
        const { execSync } = require("node:child_process")
        const pid = execSync(
          `nohup officecli watch ${JSON.stringify(args.file)} > /tmp/officecli-watch.log 2>&1 & echo $!`,
          { encoding: "utf-8", timeout: 5_000 },
        ).trim()
        return `Live preview started (PID ${pid}). Open http://localhost:26315 in your browser.`
      },
    },
  },
})