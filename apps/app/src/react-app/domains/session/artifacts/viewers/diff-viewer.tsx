/** @jsxImportSource react */
import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DiffViewerProps {
  diff: string;
  className?: string;
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

export function DiffViewer({ diff, className }: DiffViewerProps) {
  const hunks = useMemo(() => parseDiff(diff), [diff]);

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
                <DiffLineRow key={`old-${idx}`} line={line} side="old" />
              ))}
            </div>
            <div className="bg-green-2/30">
              {hunk.lines.map((line, idx) => (
                <DiffLineRow key={`new-${idx}`} line={line} side="new" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DiffLineRow({ line, side }: { line: DiffLine; side: "old" | "new" }) {
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
      <span className="whitespace-pre-wrap break-all">{line.content || " "}</span>
    </div>
  );
}