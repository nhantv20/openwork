/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { cn } from "@/lib/utils";

interface DiffViewerProps {
  diff: string;
  className?: string;
  language?: string;
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

type HighlightedLines = Record<string, string>;

const SHIKI_THEME = "github-light";

function parseDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split("\n");
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkHeader) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkHeader[1], 10),
        oldLines: parseInt(hunkHeader[2] || "1", 10),
        newStart: parseInt(hunkHeader[3], 10),
        newLines: parseInt(hunkHeader[4] || "1", 10),
        lines: [],
      };
      oldLineNum = currentHunk.oldStart;
      newLineNum = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({
        type: "add",
        content: line.substring(1),
        newLineNumber: newLineNum++,
      });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({
        type: "remove",
        content: line.substring(1),
        oldLineNumber: oldLineNum++,
      });
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({
        type: "context",
        content: line.startsWith(" ") ? line.substring(1) : line,
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
      });
    }
  }

  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractLineHtml(shikiHtml: string): string[] {
  const lines: string[] = [];
  const lineRegex = /<span class="line">(.*?)<\/span>/g;
  let match;
  while ((match = lineRegex.exec(shikiHtml)) !== null) {
    lines.push(match[1]);
  }
  return lines;
}

function useHighlightedHunks(hunks: DiffHunk[], language: string | undefined): HighlightedLines {
  const [highlighted, setHighlighted] = useState<HighlightedLines>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!language) {
      setHighlighted({});
      return;
    }

    let cancelled = false;
    const lang = mapExtensionToShikiLang(language);

    async function highlight() {
      const result: HighlightedLines = {};

      for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i];
        if (!mountedRef.current || cancelled) return;

        const oldLines = hunk.lines
          .filter((l) => l.type === "context" || l.type === "remove")
          .map((l) => l.content);
        const newLines = hunk.lines
          .filter((l) => l.type === "context" || l.type === "add")
          .map((l) => l.content);

        const [oldHtml, newHtml] = await Promise.all([
          oldLines.length > 0 ? codeToHtml(oldLines.join("\n"), { lang, theme: SHIKI_THEME }) : null,
          newLines.length > 0 ? codeToHtml(newLines.join("\n"), { lang, theme: SHIKI_THEME }) : null,
        ]);

        if (!mountedRef.current || cancelled) return;

        const oldParsed = oldHtml ? extractLineHtml(oldHtml) : [];
        const newParsed = newHtml ? extractLineHtml(newHtml) : [];

        let oldIdx = 0;
        let newIdx = 0;
        for (const line of hunk.lines) {
          const key = `${i}:${line.oldLineNumber ?? ""}:${line.newLineNumber ?? ""}:${line.type}`;
          if (line.type === "context" || line.type === "remove") {
            result[key] = oldParsed[oldIdx] ?? escapeHtml(line.content);
            oldIdx++;
          }
          if (line.type === "context" || line.type === "add") {
            result[key] = newParsed[newIdx] ?? escapeHtml(line.content);
            newIdx++;
          }
        }
      }

      if (!cancelled && mountedRef.current) {
        setHighlighted(result);
      }
    }

    highlight();

    return () => {
      cancelled = true;
    };
  }, [hunks, language]);

  return highlighted;
}

function mapExtensionToShikiLang(extOrLang: string): string {
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript", mts: "typescript", cts: "typescript",
    py: "python", rb: "ruby", rs: "rust", go: "go", java: "java",
    kt: "kotlin", swift: "swift", cs: "csharp", php: "php",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    css: "css", scss: "scss", sass: "sass", less: "less",
    html: "html", htm: "html", xml: "xml", json: "json", jsonc: "json",
    yaml: "yaml", yml: "yaml", md: "markdown", mdx: "markdown",
    sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
    vue: "vue", svelte: "svelte", astro: "astro",
    graphql: "graphql", gql: "graphql",
    dockerfile: "dockerfile", toml: "toml", ini: "ini",
    lua: "lua", r: "r", dart: "dart", prisma: "prisma",
  };
  return map[extOrLang] ?? extOrLang;
}

export function DiffViewer({ diff, className, language }: DiffViewerProps) {
  const hunks = useMemo(() => parseDiff(diff), [diff]);
  const highlighted = useHighlightedHunks(hunks, language);

  if (hunks.length === 0) {
    return (
      <pre className={cn("h-full overflow-auto p-4 text-xs font-mono whitespace-pre", className)}>
        {diff}
      </pre>
    );
  }

  return (
    <div className={cn("h-full overflow-auto bg-background", className)}>
      {hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx} className="border-b border-border">
          <div className="sticky top-0 z-10 bg-muted/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          <div className="grid grid-cols-2 divide-x divide-border font-mono text-xs">
            <div className="bg-red-2/30">
              {hunk.lines.map((line, idx) => (
                <DiffLineRow
                  key={`old-${idx}`}
                  line={line}
                  side="old"
                  highlightedHtml={highlighted[`${hunkIdx}:${line.oldLineNumber ?? ""}:${line.newLineNumber ?? ""}:${line.type}`]}
                />
              ))}
            </div>
            <div className="bg-green-2/30">
              {hunk.lines.map((line, idx) => (
                <DiffLineRow
                  key={`new-${idx}`}
                  line={line}
                  side="new"
                  highlightedHtml={highlighted[`${hunkIdx}:${line.oldLineNumber ?? ""}:${line.newLineNumber ?? ""}:${line.type}`]}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffLineRow({ line, side, highlightedHtml }: { line: DiffLine; side: "old" | "new"; highlightedHtml?: string }) {
  const isVisible =
    (side === "old" && (line.type === "context" || line.type === "remove")) ||
    (side === "new" && (line.type === "context" || line.type === "add"));

  if (!isVisible) {
    return <div className="flex px-2 py-0.5">&nbsp;</div>;
  }

  const lineNum = side === "old" ? line.oldLineNumber : line.newLineNumber;
  const bgClass =
    line.type === "add"
      ? "bg-green-2 text-green-11"
      : line.type === "remove"
        ? "bg-red-2 text-red-11"
        : "";

  return (
    <div className={cn("flex items-start gap-2 px-2 py-0.5 hover:bg-accent/30", bgClass)}>
      <span className="w-10 shrink-0 select-none text-right text-muted-foreground">
        {lineNum ?? ""}
      </span>
      <span className="w-2 shrink-0 select-none text-muted-foreground">
        {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
      </span>
      {highlightedHtml ? (
        <span
          className="whitespace-pre-wrap break-all [&>span]:!bg-transparent"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <span className="whitespace-pre-wrap break-all">{line.content || " "}</span>
      )}
    </div>
  );
}