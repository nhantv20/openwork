/**
 * Phase 6, slice 6.5a — Unified-diff generator.
 *
 * Pure helper that produces a unified-diff string for two text contents.
 * Used by the `GET /workspace/:id/history/diff` endpoint and by the
 * FileHistoryPanel's "Compare" feature (slice 6.5a fills the stub from
 * slice 6.3).
 *
 * Output format is compatible with `apps/app/src/react-app/domains/
 * session/artifacts/viewers/diff-viewer.tsx`, which parses `@@ -a,b +c,d @@`
 * hunks with `-`/`+`/` ` line prefixes.
 */
import { createPatch } from "diff";

export const MAX_DIFF_INPUT_BYTES = 1_000_000;

export type UnifiedDiffOptions = {
  /** File label for the diff header. Defaults to "snapshot". */
  fileName?: string;
  /** Old revision label. Defaults to "old". */
  oldLabel?: string;
  /** New revision label. Defaults to "new". */
  newLabel?: string;
  /** Context lines around each hunk. Defaults to 3. */
  contextLines?: number;
};

export class PayloadTooLargeError extends Error {
  constructor(public readonly side: "old" | "new", public readonly size: number) {
    super(`${side} content (${size} bytes) exceeds MAX_DIFF_INPUT_BYTES (${MAX_DIFF_INPUT_BYTES})`);
    this.name = "PayloadTooLargeError";
  }
}

function assertSize(text: string, side: "old" | "new"): void {
  const size = Buffer.byteLength(text, "utf8");
  if (size > MAX_DIFF_INPUT_BYTES) {
    throw new PayloadTooLargeError(side, size);
  }
}

/**
 * Build a unified-diff string. Returns "" when the inputs are identical.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  options: UnifiedDiffOptions = {},
): string {
  assertSize(oldText, "old");
  assertSize(newText, "new");

  if (oldText === newText) return "";

  const fileName = options.fileName ?? "snapshot";
  const oldLabel = options.oldLabel ?? "old";
  const newLabel = options.newLabel ?? "new";
  const context = options.contextLines ?? 3;

  return createPatch(fileName, oldText, newText, oldLabel, newLabel, { context });
}
