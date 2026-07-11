/**
 * Phase 6, slice 6.3 — History API routes.
 *
 * Exposes 5 REST endpoints under `/workspace/:id/history/*`:
 *   1. GET  /workspace/:id/history?path=     — list snapshots for a file
 *   2. POST /workspace/:id/history/snapshot  — create a manual snapshot
 *   3. GET  /workspace/:id/history/diff      — diff two snapshots (501 stub, slice 6.5a fills)
 *   4. GET  /workspace/:id/history/:snapId/content  — fetch snapshot content
 *   5. POST /workspace/:id/history/:snapId/restore  — restore file to a snapshot
 *
 * Path is passed via query param `?path=` instead of URL segment because
 * subdir files contain `/` (e.g. `src/Button.tsx`) which would otherwise
 * need URL-encoding. See WBS round-3 review item #14.
 *
 * Route registration order matters: #1-#3 have static tails and must be
 * registered before #4-#5 (which use `:snapshotId`).
 */
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { recordAudit } from "../audit.js";
import { PayloadTooLargeError, unifiedDiff } from "../diff.js";
import { ApiError } from "../errors.js";
import { SnapshotStore } from "../file-snapshots.js";
import { fireMaybeSnapshot } from "../snapshot-middleware.js";
import { normalizeWorkspaceRelativePath } from "../server/normalize-path.js";
import type { FileSnapshot, ServerConfig, WorkspaceInfo } from "../types.js";
import { ensureDir, shortId } from "../utils.js";
import { addRoute, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

export interface RegisterHistoryRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  ensureWritable: (config: ServerConfig) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

const MAX_DIFF_INPUT_BYTES = 1_000_000;

// ---------------------------------------------------------------------------
// Changes DB (slice 6.5b)
// ---------------------------------------------------------------------------
// Workspace-wide "all changes" summary: one row per file_path that has at
// least one snapshot, grouped + sorted by latest snapshot. Implemented as a
// thin DB accessor over runtime.sqlite so the GROUP BY + HAVING runs in the
// SQL engine rather than in JS.

type ChangesRow = { filePath: string; latestAt: number; count: number; trigger: string };

type ChangesDb = {
  changes: (workspaceId: string, limit: number) => ChangesRow[];
  changesSince: (workspaceId: string, before: number, limit: number) => ChangesRow[];
};

function changesDbPath(config: ServerConfig): string {
  const override = process.env.OPENWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "openwork");
  return join(configDir, "runtime.sqlite");
}

const changesDbByPath = new Map<string, Promise<ChangesDb>>();

async function getChangesDb(config: ServerConfig): Promise<ChangesDb> {
  const path = changesDbPath(config);
  const existing = changesDbByPath.get(path);
  if (existing) return existing;
  const next = openChangesDb(path);
  changesDbByPath.set(path, next);
  return next;
}

async function openChangesDb(path: string): Promise<ChangesDb> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(path, { readonly: true });
    const changes = (workspaceId: string, limit: number): ChangesRow[] => {
      const rows = sqlite
        .query(
          `SELECT file_path AS filePath,
                  MAX(created_at) AS latestAt,
                  COUNT(*) AS count,
                  (SELECT trigger FROM file_snapshots s2
                   WHERE s2.workspace_id = ? AND s2.file_path = file_snapshots.file_path
                   ORDER BY s2.created_at DESC LIMIT 1) AS trigger
           FROM file_snapshots
           WHERE workspace_id = ?
           GROUP BY file_path
           ORDER BY MAX(created_at) DESC
           LIMIT ?`,
        )
        .all(workspaceId, workspaceId, limit) as ChangesRow[];
      return rows;
    };
    const changesSince = (workspaceId: string, before: number, limit: number): ChangesRow[] => {
      const rows = sqlite
        .query(
          `SELECT file_path AS filePath,
                  MAX(created_at) AS latestAt,
                  COUNT(*) AS count,
                  (SELECT trigger FROM file_snapshots s2
                   WHERE s2.workspace_id = ? AND s2.file_path = file_snapshots.file_path
                   ORDER BY s2.created_at DESC LIMIT 1) AS trigger
           FROM file_snapshots
           WHERE workspace_id = ?
           GROUP BY file_path
           HAVING MAX(created_at) < ?
           ORDER BY MAX(created_at) DESC
           LIMIT ?`,
        )
        .all(workspaceId, workspaceId, before, limit) as ChangesRow[];
      return rows;
    };
    return { changes, changesSince };
  }

  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path, { readOnly: true });
  const changes = (workspaceId: string, limit: number): ChangesRow[] => {
    return sqlite
      .prepare(
        `SELECT file_path AS filePath,
                MAX(created_at) AS latestAt,
                COUNT(*) AS count,
                (SELECT trigger FROM file_snapshots s2
                 WHERE s2.workspace_id = ? AND s2.file_path = file_snapshots.file_path
                 ORDER BY s2.created_at DESC LIMIT 1) AS trigger
         FROM file_snapshots
         WHERE workspace_id = ?
         GROUP BY file_path
         ORDER BY MAX(created_at) DESC
         LIMIT ?`,
      )
      .all(workspaceId, workspaceId, limit) as ChangesRow[];
  };
  const changesSince = (workspaceId: string, before: number, limit: number): ChangesRow[] => {
    return sqlite
      .prepare(
        `SELECT file_path AS filePath,
                MAX(created_at) AS latestAt,
                COUNT(*) AS count,
                (SELECT trigger FROM file_snapshots s2
                 WHERE s2.workspace_id = ? AND s2.file_path = file_snapshots.file_path
                 ORDER BY s2.created_at DESC LIMIT 1) AS trigger
         FROM file_snapshots
         WHERE workspace_id = ?
         GROUP BY file_path
         HAVING MAX(created_at) < ?
         ORDER BY MAX(created_at) DESC
         LIMIT ?`,
      )
      .all(workspaceId, workspaceId, before, limit) as ChangesRow[];
  };
  return { changes, changesSince };
}

function readPathFromQuery(url: URL): string {
  const value = url.searchParams.get("path");
  if (!value || !value.trim()) {
    throw new ApiError(400, "invalid_path", "Query param 'path' is required");
  }
  return normalizeWorkspaceRelativePath(value, { allowSubdirs: true });
}

function readSnapshotIdFromQuery(url: URL): string {
  const value = url.searchParams.get("snapshotId");
  if (!value || !value.trim()) {
    throw new ApiError(400, "invalid_snapshot", "Query param 'snapshotId' is required");
  }
  return value.trim();
}

export function addHistoryRoutes(options: RegisterHistoryRoutesOptions): void {
  const { routes, config, jsonResponse, readJsonBody, ensureWritable, resolveWorkspace } = options;
  const store = new SnapshotStore(config);

  // Phase 6, slice 6.5b — workspace-wide change summary.
  // Returns one row per file_path that has at least one snapshot, sorted
  // by latest snapshot created_at DESC. Cursor pagination pushed to the
  // HAVING clause so we don't scan all snapshots just to throw away
  // groups (WBS round-3 review #18).
  addRoute(routes, "GET", "/workspace/:id/changes", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const limitRaw = ctx.url.searchParams.get("limit");
    const beforeRaw = ctx.url.searchParams.get("before");
    const limit = Math.max(1, Math.min(500, limitRaw ? Number(limitRaw) || 100 : 100));
    const before = beforeRaw ? Number(beforeRaw) : null;

    const db = await getChangesDb(config);
    let rows: Array<{ filePath: string; latestAt: number; count: number; trigger: string }>;
    if (before !== null && Number.isFinite(before)) {
      rows = db.changesSince(workspace.id, before, limit + 1);
    } else {
      rows = db.changes(workspace.id, limit + 1);
    }
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      filePath: row.filePath,
      latestSnapshotAt: row.latestAt,
      snapshotCount: row.count,
      latestTrigger: row.trigger === "manual" ? "manual" : "auto",
    }));
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].latestSnapshotAt : null;
    return jsonResponse({ items, nextCursor });
  });

  // 1. GET /workspace/:id/history?path=&limit=&before= — list snapshots for a file.
  addRoute(routes, "GET", "/workspace/:id/history", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const limitRaw = ctx.url.searchParams.get("limit");
    const beforeRaw = ctx.url.searchParams.get("before");
    const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw) || 50)) : 50;
    const before = beforeRaw ? Number(beforeRaw) : undefined;
    const items = await store.list(workspace.id, filePath, {
      limit,
      before: Number.isFinite(before) ? before : undefined,
    });
    return jsonResponse({ items });
  });

  // 2. POST /workspace/:id/history/snapshot?path= — create a manual snapshot.
  addRoute(routes, "POST", "/workspace/:id/history/snapshot", "client", async (ctx) => {
    ensureWritable(config);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const body = await readJsonBody(ctx.request);
    if (typeof body.content !== "string") {
      throw new ApiError(400, "invalid_input", "Body 'content' must be a string");
    }
    const trigger = body.trigger === "manual" ? "manual" : "auto";
    const result = await store.save({
      workspaceId: workspace.id,
      filePath,
      content: body.content,
      trigger,
    });
    return jsonResponse({ snapshot: result.snapshot, deduped: result.deduped, trimmed: result.trimmed });
  });

  // 3. GET /workspace/:id/history/diff?path=&from=&to= — slice 6.5a fills this.
  addRoute(routes, "GET", "/workspace/:id/history/diff", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const from = ctx.url.searchParams.get("from");
    const to = ctx.url.searchParams.get("to");
    if (!from || !to) {
      throw new ApiError(400, "invalid_input", "Query params 'from' and 'to' are required");
    }
    const fromSnap = from === "current" ? null : await store.getById(workspace.id, from);
    const toSnap = to === "current" ? null : await store.getById(workspace.id, to);
    if (from !== "current" && !fromSnap) {
      throw new ApiError(404, "snapshot_not_found", `Snapshot '${from}' not found`);
    }
    if (to !== "current" && !toSnap) {
      throw new ApiError(404, "snapshot_not_found", `Snapshot '${to}' not found`);
    }
    if (fromSnap && fromSnap.filePath !== filePath) {
      throw new ApiError(400, "path_mismatch", `Snapshot '${from}' was not created for this file path`);
    }
    if (toSnap && toSnap.filePath !== filePath) {
      throw new ApiError(400, "path_mismatch", `Snapshot '${to}' was not created for this file path`);
    }
    let fromText = fromSnap?.content ?? "";
    let toText = toSnap?.content ?? "";
    if (from === "current") {
      // Lazy require to avoid pulling fs into the boot path of routes that
      // don't use this branch. The server is already reading files in
      // routes/files.ts so this is a cheap include.
      const { readFile } = await import("node:fs/promises");
      const abs = join(workspace.path, filePath);
      try {
        fromText = await readFile(abs, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        fromText = "";
      }
    }
    if (to === "current") {
      const { readFile } = await import("node:fs/promises");
      const abs = join(workspace.path, filePath);
      try {
        toText = await readFile(abs, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        toText = "";
      }
    }
    let diff: string;
    try {
      diff = unifiedDiff(fromText, toText, {
        fileName: filePath,
        oldLabel: fromSnap ? fromSnap.id : "current",
        newLabel: toSnap ? toSnap.id : "current",
      });
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        throw new ApiError(413, "payload_too_large", err.message);
      }
      throw err;
    }
    return jsonResponse({
      diff,
      fromMeta: fromSnap ? snapshotMeta(fromSnap) : { id: "current", createdAt: 0, size: fromText.length, trigger: "auto" },
      toMeta: toSnap ? snapshotMeta(toSnap) : { id: "current", createdAt: 0, size: toText.length, trigger: "auto" },
    });
  });

  // 4. GET /workspace/:id/history/:snapshotId/content?path= — fetch snapshot content.
  // `path` is the file path; we re-validate that the snapshot's stored
  // filePath matches the supplied one (defense in depth).
  addRoute(routes, "GET", "/workspace/:id/history/:snapshotId/content", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const snapshotId = ctx.params.snapshotId;
    const snapshot = await store.getById(workspace.id, snapshotId);
    if (!snapshot) {
      throw new ApiError(404, "snapshot_not_found", `No snapshot '${snapshotId}' in workspace`);
    }
    if (snapshot.filePath !== filePath) {
      throw new ApiError(400, "path_mismatch", "Snapshot was not created for this file path");
    }
    return jsonResponse({
      content: snapshot.content,
      contentHash: snapshot.contentHash,
      createdAt: snapshot.createdAt,
    });
  });

  // 5. POST /workspace/:id/history/:snapshotId/restore?path= — restore file.
  addRoute(routes, "POST", "/workspace/:id/history/:snapshotId/restore", "client", async (ctx) => {
    ensureWritable(config);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const snapshotId = ctx.params.snapshotId;
    const body = await readJsonBody(ctx.request);
    const expectedRevision =
      typeof body.revision === "string" && body.revision.trim() ? body.revision.trim() : null;

    const snapshot = await store.getById(workspace.id, snapshotId);
    if (!snapshot) {
      throw new ApiError(404, "snapshot_not_found", `No snapshot '${snapshotId}' in workspace`);
    }
    if (snapshot.filePath !== filePath) {
      throw new ApiError(400, "path_mismatch", "Snapshot was not created for this file path");
    }

    const absolutePath = join(workspace.path, filePath);
    let currentRevision: string | null = null;
    try {
      const current = await stat(absolutePath);
      currentRevision = `${current.mtimeMs}:${current.size}`;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    if (expectedRevision && currentRevision !== expectedRevision) {
      throw new ApiError(409, "conflict", "File changed before restore could be applied", {
        expectedRevision,
        currentRevision,
      });
    }

    // Phase 6 round-3 review: snapshot the pre-restore state first so
    // restore is itself reversible. The middleware's skipAutoSnapshot
    // flag is what stops THIS write from triggering a recursive auto.
    fireMaybeSnapshot(config, store, {
      workspaceId: workspace.id,
      workspaceRoot: workspace.path,
      filePath,
      revision: currentRevision,
      skipAutoSnapshot: false, // we DO want a pre-restore snapshot
    });

    // The actual restore write must set skipAutoSnapshot: true to prevent
    // a chain of auto-snapshots. We do this via a direct writeFile rather
    // than re-entering the routes/files.ts write path (which has its own
    // audit + approval flow). For now, restore is a "best effort, no
    // approval" operation gated only by `ensureWritable`.
    await ensureDir(dirname(absolutePath));
    const tmp = `${absolutePath}.tmp-${shortId()}`;
    await writeFile(tmp, snapshot.content, "utf8");
    await rename(tmp, absolutePath);
    const after = await stat(absolutePath);
    const newRevision = `${after.mtimeMs}:${after.size}`;

    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "history.restore",
      target: absolutePath,
      summary: `Restored ${filePath} from snapshot ${snapshotId}`,
      timestamp: Date.now(),
    });

    return jsonResponse({ ok: true, path: filePath, newRevision, snapshot });
  });
}

function snapshotMeta(snap: FileSnapshot) {
  return {
    id: snap.id,
    createdAt: snap.createdAt,
    size: snap.size,
    trigger: snap.trigger,
  };
}
