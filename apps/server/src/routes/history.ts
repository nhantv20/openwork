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
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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

/**
 * Count the `+`/`-` lines in a unified-diff string so the Review
 * tab's "X pending +N -M" badge has real numbers. Excludes the
 * hunk headers (`@@ -a,b +c,d @@`) and the file headers (`---
 * a`/`+++ b`) so only the actual change lines are counted.
 */
function diffLineStats(unified: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unified.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

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

// ---------------------------------------------------------------------------
// Changes DB (slice 6.5b)
// ---------------------------------------------------------------------------
// Workspace-wide "all changes" summary: one row per file_path that has at
// least one snapshot, grouped + sorted by latest snapshot. Implemented as a
// thin DB accessor over runtime.sqlite so the GROUP BY + HAVING runs in the
// SQL engine rather than in JS.

type ChangesRow = { filePath: string; latestAt: number; count: number; trigger: string; agentCount: number };

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
    // Tiebreaker: `file_path ASC` keeps ordering stable when two files
    // share the same `MAX(created_at)` (e.g. a test that creates three
    // snapshots within the same millisecond). Without it, SQLite is free
    // to return rows in any order and pagination tests flake.
    const changes = (workspaceId: string, limit: number): ChangesRow[] => {
      const rows = sqlite
        .query(
          `SELECT file_path AS filePath,
                  MAX(created_at) AS latestAt,
                  COUNT(*) AS count,
                  (SELECT trigger FROM file_snapshots s2
                   WHERE s2.workspace_id = ? AND s2.file_path = file_snapshots.file_path
                   ORDER BY s2.created_at DESC LIMIT 1) AS trigger,
                  SUM(CASE WHEN trigger = 'agent' THEN 1 ELSE 0 END) AS agentCount
           FROM file_snapshots
           WHERE workspace_id = ?
           GROUP BY file_path
           ORDER BY MAX(created_at) DESC, file_path ASC
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
                   ORDER BY s2.created_at DESC LIMIT 1) AS trigger,
                  SUM(CASE WHEN trigger = 'agent' THEN 1 ELSE 0 END) AS agentCount
           FROM file_snapshots
           WHERE workspace_id = ?
           GROUP BY file_path
           HAVING MAX(created_at) < ?
           ORDER BY MAX(created_at) DESC, file_path ASC
           LIMIT ?`,
        )
        .all(workspaceId, workspaceId, before, limit) as ChangesRow[];
      return rows;
    };
    return { changes, changesSince };
  }

  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path, { readOnly: true });
  // See the bun:sqlite path above for why the tiebreaker is needed.
  const changes = (workspaceId: string, limit: number): ChangesRow[] => {
    return sqlite
      .prepare(
        `SELECT file_path AS filePath,
                MAX(created_at) AS latestAt,
                COUNT(*) AS count,
                (SELECT trigger FROM file_snapshots s2
                 WHERE s2.workspace_id = ? AND s2.file_path = file_snapshots.file_path
                 ORDER BY s2.created_at DESC LIMIT 1) AS trigger,
                SUM(CASE WHEN trigger = 'agent' THEN 1 ELSE 0 END) AS agentCount
         FROM file_snapshots
         WHERE workspace_id = ?
         GROUP BY file_path
         ORDER BY MAX(created_at) DESC, file_path ASC
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
                 ORDER BY s2.created_at DESC LIMIT 1) AS trigger,
                SUM(CASE WHEN trigger = 'agent' THEN 1 ELSE 0 END) AS agentCount
         FROM file_snapshots
         WHERE workspace_id = ?
         GROUP BY file_path
         HAVING MAX(created_at) < ?
         ORDER BY MAX(created_at) DESC, file_path ASC
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
    let rows: Array<{ filePath: string; latestAt: number; count: number; trigger: string; agentCount: number }>;
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
      latestTrigger: row.trigger === "manual" || row.trigger === "agent" ? row.trigger : "auto",
      agentSnapshotCount: row.agentCount ?? 0,
    }));
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].latestSnapshotAt : null;
    return jsonResponse({ items, nextCursor });
  });

  // 1. GET /workspace/:id/history?path=&limit=&before=&trigger= — list snapshots for a file.
  addRoute(routes, "GET", "/workspace/:id/history", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const limitRaw = ctx.url.searchParams.get("limit");
    const beforeRaw = ctx.url.searchParams.get("before");
    const triggerRaw = ctx.url.searchParams.get("trigger");
    const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw) || 50)) : 50;
    const before = beforeRaw ? Number(beforeRaw) : undefined;
    // Phase 6.7: optional trigger filter so the History tab can show
    // only agent-written snapshots without a full client-side scan.
    const trigger =
      triggerRaw === "auto" || triggerRaw === "manual" || triggerRaw === "agent"
        ? triggerRaw
        : undefined;
    let items = await store.list(workspace.id, filePath, {
      limit,
      before: Number.isFinite(before) ? before : undefined,
    });
    if (trigger) {
      items = items.filter((snap) => snap.trigger === trigger);
    }
    return jsonResponse({ items });
  });

  // 1b. GET /workspace/:id/history/latest?path= — round-5 fix: cheaper endpoint
  // for the HistoryStatusBadge poll. Avoids the cost of fetching the full list
  // (and the badge never reads beyond item[0]).
  addRoute(routes, "GET", "/workspace/:id/history/latest", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const snapshot = await store.findLatest(workspace.id, filePath);
    return jsonResponse({ snapshot });
  });

  // 1c. GET /workspace/:id/history/agent-latest?path= — Phase 6.8: latest
  // agent-triggered snapshot for a file, or null. Used by the agent
  // review banner to decide whether to surface a notification. Kept
  // separate from /latest (which returns the most recent of any
  // trigger) so a freshly-typed manual save doesn't hide an
  // older-but-pending agent edit.
  addRoute(routes, "GET", "/workspace/:id/history/agent-latest", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const snapshot = await store.findLatest(workspace.id, filePath, { trigger: "agent" });
    return jsonResponse({ snapshot });
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
    const trigger =
      body.trigger === "manual" || body.trigger === "agent"
        ? body.trigger
        : "auto";
    // Phase 6.9: accept parentSnapshotId so the agent-edit path can
    // pre-stamp the row with the snapshot id of the pre-AI version.
    // Backwards-compatible: missing / null is fine for non-agent rows.
    const parentSnapshotId =
      typeof body.parentSnapshotId === "string" && body.parentSnapshotId.trim()
        ? body.parentSnapshotId
        : null;
    const result = await store.save({
      workspaceId: workspace.id,
      filePath,
      content: body.content,
      trigger,
      parentSnapshotId,
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
      // Phase 6 round-4 fix: use byteLength (not string.length) for "current"
      // meta to match the units used by snapshot rows. Mismatch made the
      // UI report 2 bytes for a 2-char emoji-only file.
      fromMeta: fromSnap ? snapshotMeta(fromSnap) : { id: "current", createdAt: 0, size: Buffer.byteLength(fromText, "utf8"), trigger: "auto" },
      toMeta: toSnap ? snapshotMeta(toSnap) : { id: "current", createdAt: 0, size: Buffer.byteLength(toText, "utf8"), trigger: "auto" },
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
    // Phase 6 round-4: pre-read the current file so the snapshot
    // captures the OLD content even though we overwrite the file right
    // after. Without preRead, fireMaybeSnapshot would re-read the file
    // after the write and capture the new (restored) content.
    const preRestore = await readFile(absolutePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    const preRestoreBuffer = preRestore ? Buffer.from(preRestore) : null;
    fireMaybeSnapshot(
      config,
      store,
      {
        workspaceId: workspace.id,
        workspaceRoot: workspace.path,
        filePath,
        revision: currentRevision,
        skipAutoSnapshot: false, // we DO want a pre-restore snapshot
        trigger: "manual", // intentional; not an automatic save
      },
      preRestoreBuffer
        ? {
            content: preRestoreBuffer.toString("utf8"),
            hash: createHash("sha256").update(preRestoreBuffer).digest("hex"),
            size: preRestoreBuffer.length,
          }
        : undefined,
    );

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

  // -------------------------------------------------------------------------
  // Phase 6.9: Review Tab — approval workflow routes
  // -------------------------------------------------------------------------
  // These are mounted under `/workspace/:id/approvals/...` (instead of
  // `/history/...`) so the Review tab can call a single, stable surface
  // that owns the full approve/reject lifecycle. Restore-on-reject is
  // delegated to the existing `/history/:snapshotId/restore` path so we
  // don't duplicate the pre-restore + revision-check logic.

  // 6. GET /workspace/:id/pending-approvals — list files with a pending
  //    agent snapshot. Powers the Review tab's "Changes" list.
  addRoute(routes, "GET", "/workspace/:id/pending-approvals", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const rows = await store.listAgentSnapshots(workspace.id, { status: "pending", limit: 200 });
    // Phase 6.9 hotfix: for legacy agent snapshots where
    // `parentSnapshotId` is null (saved before the agent-edit-poller
    // started stamping it), look up the most recent non-agent
    // snapshot for the same file at response time. This avoids a
    // destructive backfill migration while still making the diff
    // work for users with existing pending rows.
    //
    // We also compute the actual `+N -M` line counts from a
    // parent → current-file diff so the Review tab header can show
    // a real "Edited N files +A -B" summary, not a placeholder.
    const enriched = await Promise.all(
      rows.map(async (snap) => {
        let parentId = snap.parentSnapshotId ?? null;
        if (parentId === null) {
          const latest = await store.findLatestNonAgent(workspace.id, snap.filePath);
          if (latest) {
            parentId = latest.id;
          }
        }

        // Read parent + current. We swallow ENOENT and oversized
        // payloads so a single bad row doesn't poison the whole
        // list — the line counts just stay 0.
        let addedLines = 0;
        let removedLines = 0;
        let diffSummary = "";
        if (parentId) {
          const parent = await store.getById(workspace.id, parentId);
          const abs = join(workspace.path, snap.filePath);
          const current = await readFile(abs, "utf8").catch((err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") return "";
            throw err;
          });
          if (parent) {
            try {
              const patch = unifiedDiff(parent.content, current, {
                fileName: snap.filePath,
                oldLabel: parent.id,
                newLabel: "current",
              });
              const stats = diffLineStats(patch);
              addedLines = stats.added;
              removedLines = stats.removed;
              diffSummary = `+${addedLines} -${removedLines}`;
            } catch (err) {
              if (!(err instanceof PayloadTooLargeError)) throw err;
            }
          }
        }

        return {
          filePath: snap.filePath,
          snapshotId: snap.id,
          parentSnapshotId: parentId,
          createdAt: snap.createdAt,
          addedLines,
          removedLines,
          diffSummary,
          size: snap.size,
        };
      }),
    );
    return jsonResponse({ items: enriched });
  });

  // 7. POST /workspace/:id/approvals/:snapshotId/approve — flip an
  //    agent snapshot to "approved". Pure metadata write; the file on
  //    disk is left as-is so git picks it up normally.
  addRoute(routes, "POST", "/workspace/:id/approvals/:snapshotId/approve", "client", async (ctx) => {
    ensureWritable(config);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const snapshotId = ctx.params.snapshotId;
    const snapshot = await store.getById(workspace.id, snapshotId);
    if (!snapshot) {
      throw new ApiError(404, "snapshot_not_found", `Snapshot '${snapshotId}' not found`);
    }
    if (snapshot.trigger !== "agent") {
      throw new ApiError(
        400,
        "not_agent_snapshot",
        `Snapshot '${snapshotId}' is not an agent snapshot`,
      );
    }
    const updated = await store.approve(workspace.id, snapshotId);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "review.approve",
      target: snapshot.filePath,
      summary: `Approved agent edit on ${snapshot.filePath}`,
      timestamp: Date.now(),
    });
    return jsonResponse({ ok: true, snapshot: updated });
  });

  // 8. POST /workspace/:id/approvals/:snapshotId/reject — restore the
  //    file from `parentSnapshotId` (when available) and flip the
  //    snapshot to "rejected". Returns 409 with code NO_PARENT_SNAPSHOT
  //    when the row has no pre-AI parent (recoverable on the client
  //    with an explicit "leave as-is" confirm).
  addRoute(routes, "POST", "/workspace/:id/approvals/:snapshotId/reject", "client", async (ctx) => {
    ensureWritable(config);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const snapshotId = ctx.params.snapshotId;
    const snapshot = await store.getById(workspace.id, snapshotId);
    if (!snapshot) {
      throw new ApiError(404, "snapshot_not_found", `Snapshot '${snapshotId}' not found`);
    }
    if (snapshot.trigger !== "agent") {
      throw new ApiError(
        400,
        "not_agent_snapshot",
        `Snapshot '${snapshotId}' is not an agent snapshot`,
      );
    }
    // Phase 6.9 hotfix: legacy snapshots (saved before
    // agent-edit-poller started stamping parentSnapshotId) get the
    // same in-memory backfill as the pending-approvals list. Without
    // this, those rows are forever un-rejectable.
    let effectiveParentId = snapshot.parentSnapshotId;
    if (effectiveParentId == null) {
      const latest = await store.findLatestNonAgent(workspace.id, snapshot.filePath);
      if (latest) {
        effectiveParentId = latest.id;
        // Backfill the row so subsequent calls are O(1) and the
        // History tab shows the link too.
        await store.setParentSnapshotId(workspace.id, snapshotId, latest.id);
      }
    }
    if (effectiveParentId == null) {
      throw new ApiError(
        409,
        "no_parent_snapshot",
        "Cannot reject: no pre-AI snapshot available to restore",
        { snapshotId, filePath: snapshot.filePath },
      );
    }
    const parent = await store.getById(workspace.id, effectiveParentId);
    if (!parent) {
      throw new ApiError(
        409,
        "parent_snapshot_missing",
        "Pre-AI snapshot has been trimmed; cannot restore",
        { snapshotId, parentSnapshotId: effectiveParentId },
      );
    }
    // Restore is the same code path as the manual /history/.../restore
    // route. We inline the file write here to avoid a second round-trip
    // and to keep `recordAudit` consistent with the approve path.
    //
    // Note (L4 review): we deliberately do NOT pre-snapshot the post-AI
    // content here. The snapshot store dedups on (workspace, file,
    // contentHash), and the agent snapshot we just rejected already
    // holds the post-AI content under status="rejected" — the user can
    // find it on the History tab and restore from there. Adding a
    // pre-reject snapshot would just dedup against the existing agent
    // row and create the false impression that a separate copy exists.
    const absolutePath = join(workspace.path, snapshot.filePath);
    const currentStat = await stat(absolutePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    const currentRevision = currentStat ? `${currentStat.mtimeMs}:${currentStat.size}` : null;
    await ensureDir(dirname(absolutePath));
    const tmp = `${absolutePath}.tmp-${shortId()}`;
    await writeFile(tmp, parent.content, "utf8");
    await rename(tmp, absolutePath);
    const updated = await store.reject(workspace.id, snapshotId);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "review.reject",
      target: snapshot.filePath,
      summary: `Rejected agent edit on ${snapshot.filePath} (restored from ${parent.id})`,
      timestamp: Date.now(),
    });
    return jsonResponse({ ok: true, snapshot: updated, restoredFrom: parent.id, currentRevision });
  });

  // 9. POST /workspace/:id/approvals/approve-all — best-effort bulk
  //    approve. Per WBS round-3 review decision: parallel settle, no
  //    transaction, partial success is reported back. Client uses the
  //    failed[] list to keep the corresponding rows in the UI and
  //    offer a retry.
  addRoute(routes, "POST", "/workspace/:id/approvals/approve-all", "client", async (ctx) => {
    ensureWritable(config);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const snapshotIds = Array.isArray(body.snapshotIds)
      ? body.snapshotIds.filter((id): id is string => typeof id === "string")
      : [];
    const results = await Promise.allSettled(
      snapshotIds.map((snapshotId) => store.approve(workspace.id, snapshotId)),
    );
    let approvedCount = 0;
    const failed: Array<{ snapshotId: string; reason: string }> = [];
    results.forEach((res, i) => {
      const snapshotId = snapshotIds[i];
      if (res.status === "fulfilled") {
        if (res.value) {
          approvedCount += 1;
        } else {
          failed.push({ snapshotId, reason: "snapshot_not_found" });
        }
      } else {
        failed.push({
          snapshotId,
          reason: res.reason instanceof Error ? res.reason.message : "unknown_error",
        });
      }
    });
    return jsonResponse({ approvedCount, failed });
  });

  // 10. POST /workspace/:id/approvals/reject-all — best-effort bulk
  //     reject. Same shape as approve-all. A snapshot without a parent
  //     is reported as `reason: "no_parent_snapshot"` and left untouched.
  addRoute(routes, "POST", "/workspace/:id/approvals/reject-all", "client", async (ctx) => {
    ensureWritable(config);
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const snapshotIds = Array.isArray(body.snapshotIds)
      ? body.snapshotIds.filter((id): id is string => typeof id === "string")
      : [];
    const results = await Promise.allSettled(
      snapshotIds.map(async (snapshotId) => {
        const snapshot = await store.getById(workspace.id, snapshotId);
        if (!snapshot) throw new Error("snapshot_not_found");
        if (snapshot.parentSnapshotId == null) {
          throw new Error("no_parent_snapshot");
        }
        const parent = await store.getById(workspace.id, snapshot.parentSnapshotId);
        if (!parent) throw new Error("parent_snapshot_missing");
        const absolutePath = join(workspace.path, snapshot.filePath);
        await ensureDir(dirname(absolutePath));
        const tmp = `${absolutePath}.tmp-${shortId()}`;
        await writeFile(tmp, parent.content, "utf8");
        await rename(tmp, absolutePath);
        return store.reject(workspace.id, snapshotId);
      }),
    );
    let rejectedCount = 0;
    const failed: Array<{ snapshotId: string; reason: string }> = [];
    results.forEach((res, i) => {
      const snapshotId = snapshotIds[i];
      if (res.status === "fulfilled" && res.value) {
        rejectedCount += 1;
      } else if (res.status === "rejected") {
        failed.push({
          snapshotId,
          reason: res.reason instanceof Error ? res.reason.message : "unknown_error",
        });
      } else {
        failed.push({ snapshotId, reason: "unknown_error" });
      }
    });
    return jsonResponse({ rejectedCount, failed });
  });

  // 11. GET /workspace/:id/agent-snapshots?cursor=&limit=&status=
  //     Phase 6.9: paginated history of agent snapshots. Cursor is the
  //     `createdAt` of the last row from the previous page; pass
  //     `status` to filter. Used by the Review tab's History inner tab.
  addRoute(routes, "GET", "/workspace/:id/agent-snapshots", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const limitRaw = ctx.url.searchParams.get("limit");
    const beforeRaw = ctx.url.searchParams.get("before");
    const statusRaw = ctx.url.searchParams.get("status");
    const status =
      statusRaw === "pending" || statusRaw === "approved" || statusRaw === "rejected"
        ? statusRaw
        : undefined;
    const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw) || 50)) : 50;
    const before = beforeRaw ? Number(beforeRaw) : undefined;
    const items = await store.listAgentSnapshots(workspace.id, {
      status,
      limit: limit + 1,
      before: Number.isFinite(before) ? before : undefined,
    });
    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    const nextCursor =
      hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1].createdAt : null;
    return jsonResponse({ items: trimmed, nextCursor });
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
