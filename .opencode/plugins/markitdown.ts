import { z } from "zod"

export default async () => ({
  tool: {
    convert_to_markdown: {
      description:
        "Convert an Office file (PDF, DOCX, PPTX, XLSX) to Markdown. " +
        "Provide the input file path. Optionally specify an output path; " +
        "otherwise the result is returned as text.",
      args: z.object({
        input: z.string().describe("Path to the input file (.pdf, .docx, .pptx, .xlsx)"),
        output: z.string().optional().describe("Optional output .md file path"),
      }).shape,
      async execute(args: { input: string; output?: string }) {
        const { execSync } = await import("node:child_process")
        const cmd = args.output
          ? `markitdown ${JSON.stringify(args.input)} -o ${JSON.stringify(args.output)}`
          : `markitdown ${JSON.stringify(args.input)}`
        try {
          const stdout = execSync(cmd, { encoding: "utf-8", timeout: 60_000 })
          if (args.output) {
            return `Converted to ${args.output}`
          }
          return stdout.trim() || "Conversion complete (empty output)."
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          throw new Error(`markitdown conversion failed: ${message}`)
        }
      },
    },
  },
})