/**
 * Auto-snapshot middleware (Phase 6, slice 6.2).
 *
 * Wraps the file-write path so a snapshot of the file's PRE-write content
 * is recorded whenever a write would actually change the file. The auto
 * snapshot is intentionally best-effort + async — it never blocks the
 * write path or breaks user-visible behavior.
 *
 * Behavior (per call):
 *  1. If `skipAutoSnapshot === true`, do nothing. The flag is set by:
 *     - Manual snapshot writes (`POST /workspace/:id/history/snapshot`)
 *     - Restore writes (`POST /workspace/:id/history/:id/restore`)
 *     This prevents the classic feedback loop: user clicks Save → server
 *     writes content → middleware snapshots → new row → loop.
 *  2. Read the file's current content (if it exists). If the file is new
 *     or empty, skip.
 *  3. Reject silently if the file is "binary":
 *     - First 8KB contains a NUL byte, OR
 *     - Size > MAX_BINARY_SNAPSHOT_BYTES (5MB)
 *     No audit log, no error — matches WBS decision #2.
 *  4. Hash + write. The UNIQUE index on (workspace, file, hash) handles
 *     dedup atomically; if the content already exists as a snapshot we
 *     get back the existing row instead of an error.
 *  5. Record an audit entry of kind "snapshot-auto" with the snapshot id
 *     so an operator can trace the auto-snapshot back to its write.
 *
 * Failures (read error, DB error, hash race) are swallowed and logged to
 * stderr. The write path MUST NOT fail because snapshotting failed.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { recordAudit } from "./audit.js";
import { MAX_SNAPSHOT_BYTES, SnapshotStore } from "./file-snapshots.js";
import type { FileSnapshot, ServerConfig } from "./types.js";

const BINARY_SNIFF_BYTES = 8 * 1024;

export type MaybeSnapshotInput = {
  /** Resolved workspace id (already looked up by the caller). */
  workspaceId: string;
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /** Workspace-relative file path. */
  filePath: string;
  /**
   * Set to true when the write is itself part of the snapshot subsystem
   * (manual save, restore). Defaults to false.
   */
  skipAutoSnapshot?: boolean;
  /**
   * Override trigger — defaults to "auto". Tests pass "manual" to verify
   * the write path doesn't accidentally set "auto" on intentional saves.
   * "agent" is set by the polling-based agent-edit detector in
   * `agent-edit-poller.ts` (Phase 6.7) to distinguish OpenCode-driven
   * writes from user UI saves.
   */
  trigger?: "auto" | "manual" | "agent";
  /**
   * Optional revision from `file-sessions.ts` for cross-referencing.
   * Read by the caller from `mtimeMs:size`; passed through verbatim.
   */
  revision?: string | null;
};

export type MaybeSnapshotResult =
  | { skipped: true; reason: "explicit" | "new-file" | "binary" | "empty" | "oversize" | "race" }
  | { skipped: false; snapshot: FileSnapshot; deduped: boolean };

function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function isBinary(buf: Buffer): boolean {
  const sniff = buf.length > BINARY_SNIFF_BYTES ? buf.subarray(0, BINARY_SNIFF_BYTES) : buf;
  for (let i = 0; i < sniff.length; i += 1) {
    if (sniff[i] === 0) return true;
  }
  return false;
}

export async function maybeSnapshotBeforeWrite(
  config: ServerConfig,
  store: SnapshotStore,
  input: MaybeSnapshotInput,
): Promise<MaybeSnapshotResult> {
  if (input.skipAutoSnapshot) {
    return { skipped: true, reason: "explicit" };
  }

  const absolutePath = join(input.workspaceRoot, input.filePath);
  let current: Buffer;
  try {
    current = await readFile(absolutePath);
  } catch (err) {
    // ENOENT = new file, nothing to snapshot. Anything else = log + skip.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { skipped: true, reason: "new-file" };
    }
    console.warn(
      `[snapshot-middleware] readFile failed for ${input.filePath}:`,
      err instanceof Error ? err.message : err,
    );
    return { skipped: true, reason: "race" };
  }

  if (current.length === 0) {
    return { skipped: true, reason: "empty" };
  }
  if (current.length > MAX_SNAPSHOT_BYTES) {
    return { skipped: true, reason: "oversize" };
  }
  if (isBinary(current)) {
    return { skipped: true, reason: "binary" };
  }

  // We're treating the buffer as UTF-8 text from here on. `Buffer.toString("utf8")`
  // is lossless for valid UTF-8; invalid sequences become U+FFFD replacement
  // characters, which is acceptable for a snapshot of an already-on-disk file.
  const text = current.toString("utf8");
  const hash = hashBuffer(current);

  let result;
  try {
    result = await store.save({
      workspaceId: input.workspaceId,
      filePath: input.filePath,
      content: text,
      trigger: input.trigger ?? "auto",
      revision: input.revision ?? null,
    });
  } catch (err) {
    console.warn(
      `[snapshot-middleware] store.save failed for ${input.filePath}:`,
      err instanceof Error ? err.message : err,
    );
    return { skipped: true, reason: "race" };
  }

  // Best-effort audit. Don't fail the whole flow if audit logging is broken.
  try {
    await recordAudit(input.workspaceRoot, {
      id: `audit_${Date.now().toString(36)}_${result.snapshot.id}`,
      workspaceId: input.workspaceId,
      actor: { type: "host" },
      action: "snapshot-auto",
      target: input.filePath,
      summary: `auto-snapshot${result.deduped ? " (deduped)" : ""} of ${input.filePath} (${result.snapshot.size} B)`,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn(
      `[snapshot-middleware] recordAudit failed for ${input.filePath}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return { skipped: false, snapshot: result.snapshot, deduped: result.deduped };
}

/**
 * Fire-and-forget variant for the write path. The returned promise is
 * deliberately not awaited; any rejection is logged. Use this at the top
 * of the write handler so the snapshot happens in parallel with `writeFile`.
 *
 * **Round-4 fix:** when `preRead` is supplied, the snapshot captures THAT
 * content rather than re-reading the file from disk. This is essential
 * because the write handler continues with `writeFile(tmp, ...)` +
 * `rename(tmp, dest)`; if we re-read here we race with that and capture
 * the new content instead of the pre-write content.
 */
export function fireMaybeSnapshot(
  config: ServerConfig,
  store: SnapshotStore,
  input: MaybeSnapshotInput,
  preRead?: { content: string; hash: string; size: number },
): void {
  if (preRead) {
    snapshotFromContent(config, store, input, preRead).catch((err) => {
      console.warn(
        `[snapshot-middleware] unhandled error for ${input.filePath}:`,
        err instanceof Error ? err.message : err,
      );
    });
    return;
  }
  maybeSnapshotBeforeWrite(config, store, input).catch((err) => {
    console.warn(
      `[snapshot-middleware] unhandled error for ${input.filePath}:`,
      err instanceof Error ? err.message : err,
    );
  });
}

async function snapshotFromContent(
  config: ServerConfig,
  store: SnapshotStore,
  input: MaybeSnapshotInput,
  preRead: { content: string; hash: string; size: number },
): Promise<void> {
  if (input.skipAutoSnapshot) return;
  if (preRead.size === 0) return;
  if (preRead.size > MAX_SNAPSHOT_BYTES) return;
  if (looksLikeBinary(preRead.content)) return;

  let result;
  try {
    result = await store.save({
      workspaceId: input.workspaceId,
      filePath: input.filePath,
      content: preRead.content,
      trigger: input.trigger ?? "auto",
      revision: input.revision ?? null,
    });
  } catch (err) {
    console.warn(
      `[snapshot-middleware] store.save failed for ${input.filePath}:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }
  try {
    await recordAudit(input.workspaceRoot, {
      id: `audit_${Date.now().toString(36)}_${result.snapshot.id}`,
      workspaceId: input.workspaceId,
      actor: { type: "host" },
      action: "snapshot-auto",
      target: input.filePath,
      summary: `auto-snapshot${result.deduped ? " (deduped)" : ""} of ${input.filePath} (${result.snapshot.size} B)`,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn(
      `[snapshot-middleware] recordAudit failed for ${input.filePath}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Heuristic binary check on a string. We only sniff the first 8KB of code
 * units for U+0000 (NUL) — same threshold the disk-based check uses.
 * Catches the common case of binary files being read as UTF-8 replacement
 * characters; rare false positives on legitimately-NUL-containing text are
 * an acceptable cost (snapshot just doesn't get created).
 */
function looksLikeBinary(text: string): boolean {
  const sniff = text.length > 8192 ? text.slice(0, 8192) : text;
  for (let i = 0; i < sniff.length; i += 1) {
    if (sniff.charCodeAt(i) === 0) return true;
  }
  return false;
}
