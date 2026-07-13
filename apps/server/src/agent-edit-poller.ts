/**
 * Phase 6.7 — Agent edit poller.
 *
 * Periodically scans each workspace root and snapshots files that
 * changed on disk outside of our own HTTP write handlers. The
 * classification itself lives in `agent-edit-detector.ts`; this
 * module is just the scanner + snapshot wiring.
 *
 * Design:
 * - We use `readdir({ recursive: true, withFileTypes: true })`
 *   (Node 20+) to walk the tree in one syscall per directory.
 *   `withFileTypes` avoids an extra `stat` per file when we just
 *   need the type.
 * - We skip a small denylist of noise directories (`.git/`,
 *   `node_modules/`, etc.) so the scan stays fast and we don't
 *   snapshot obvious noise.
 * - We snapshot by calling `SnapshotStore.save({ trigger: "agent" })`
 *   directly — bypassing the snapshot middleware because the
 *   middleware is keyed on HTTP write handlers and the HTTP mark is
 *   what makes the classifier say "http" in the first place. The
 *   store handles content-hash dedup so resnapshotting an unchanged
 *   file is a no-op.
 * - Best-effort: errors are logged and never thrown. The poller is a
 *   background job — breaking the loop because one workspace is
 *   temporarily inaccessible would be wrong.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { AgentEditDetector, type ChangeKind } from "./agent-edit-detector.js";
import { recordAudit } from "./audit.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { SnapshotStore } from "./file-snapshots.js";

const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Minimal subset of the Node Dirent type that we actually use. The
 * real type is `Dirent<TBuffer>` where `TBuffer` is a Node-version
 * detail; we don't need it. */
type DirentLike = {
  isFile: () => boolean;
  isDirectory: () => boolean;
  name: string;
  path?: string;
  parentPath?: string;
};

/** Cap on a single agent-snapshot's content. Matches the
 * snapshot-middleware's 5MB cap. */
const AGENT_SNAPSHOT_MAX_BYTES = 5_000_000;

/** Directories we never snapshot. Matched on the path separator
 * boundary so `src/.git/hooks` still gets scanned; only the `.git`
 * root is excluded. */
const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".turbo",
  ".next",
  "dist",
  "build",
  ".vercel",
]);

export interface AgentEditPollerOptions {
  config: ServerConfig;
  workspaces: WorkspaceInfo[];
  store: SnapshotStore;
  detector: AgentEditDetector;
  pollIntervalMs?: number;
  logger?: { warn: (msg: string) => void; info?: (msg: string) => void };
}

export type AgentEditPollerHandle = {
  stop: () => void;
  /** Run one scan cycle for a single workspace. Used by tests. */
  scanWorkspace: (workspaceId: string) => Promise<number>;
  /** Number of files snapshotted since the poller started. */
  stats: { snapshotsCreated: number };
};

export function startAgentEditPoller(options: AgentEditPollerOptions): AgentEditPollerHandle {
  const {
    config,
    workspaces,
    store,
    detector,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    logger = console,
  } = options;

  const stats = { snapshotsCreated: 0 };
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]));

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = async () => {
    if (running) return; // overlap guard — long scan + short interval
    running = true;
    try {
      for (const workspace of workspaces) {
        try {
          const count = await scanOne(workspace);
          stats.snapshotsCreated += count;
        } catch (err) {
          logger.warn(
            `[agent-edit-poller] scan failed for ${workspace.id} (${workspace.path}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } finally {
      running = false;
    }
  };

  const scanWorkspace = async (workspaceId: string): Promise<number> => {
    const workspace = workspaceById.get(workspaceId);
    if (!workspace) return 0;
    return scanOne(workspace);
  };

  async function scanOne(workspace: WorkspaceInfo): Promise<number> {
    const absRoot = workspace.path;
    // Seed lastSeen on the first scan so we don't snapshot every
    // existing file as "agent" the moment the server boots. We
    // track this with a dedicated boolean rather than `trackedFiles
    // .length === 0` because an empty workspace would otherwise
    // stay in "first-scan" mode forever and the very first file
    // created inside it would be classified as "agent" with no
    // baseline to diff against (well — that's still correct
    // because `lastSeen === null` covers it — but the explicit
    // flag makes the intent obvious and removes the corner case).
    const isFirstScan = !detector.hasSeeded(workspace.id);
    let created = 0;

    let entries: DirentLike[];
    try {
      const raw = (await readdir(absRoot, { recursive: true, withFileTypes: true })) as unknown as DirentLike[];
      entries = raw;
    } catch (err) {
      // Workspace root gone or not accessible — skip silently.
      logger.warn(
        `[agent-edit-poller] readdir failed for ${workspace.path}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }

    // Snapshot the set of seen paths so we can detect deletions.
    const seenNow = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      // Node ≥20 returns `parentPath` (the directory containing the
      // entry) and `name` (the file name). Combine them and strip the
      // workspace root to get a relative forward-slash path. We
      // intentionally do NOT use `entry.path` — its meaning has
      // shifted across Node versions and a stale shape would silently
      // produce empty results.
      const dirPath = (entry as { parentPath?: string; path?: string }).parentPath
        ?? (entry as { path?: string }).path
        ?? "";
      const absEntry = dirPath ? join(dirPath, entry.name) : join(absRoot, entry.name);
      const relPath = relative(absRoot, absEntry).split(sep).join("/");
      if (relPath.split("/").some((seg) => SKIP_DIR_NAMES.has(seg))) continue;

      seenNow.add(relPath);
      const abs = absEntry;
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(abs);
      } catch {
        continue; // race: file disappeared between readdir and stat
      }
      const lastSeen = detector.getLastSeen(workspace.id, relPath);

      // First scan: just seed the baseline.
      if (isFirstScan || lastSeen === null) {
        detector.recordLastSeen(workspace.id, relPath, {
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
        });
        continue;
      }

      // No change? Skip.
      if (lastSeen.mtimeMs === fileStat.mtimeMs && lastSeen.size === fileStat.size) {
        continue;
      }

      // Changed — classify and act.
      const kind = detector.classifyChange(workspace.id, relPath);
      // Always update the baseline, even for "http" so we don't re-classify.
      detector.recordLastSeen(workspace.id, relPath, {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
      });
      if (kind === "http") {
        continue;
      }

      if (await trySnapshot(store, detector, workspace, relPath, abs, fileStat.size, logger)) {
        created += 1;
      }
    }

    // Detect deletions: anything in lastSeen but not in seenNow is gone.
    for (const path of detector.trackedFiles(workspace.id)) {
      if (!seenNow.has(path)) {
        detector.forget(workspace.id, path);
      }
    }

    // Mark the baseline as established so subsequent scans know to
    // diff against it.
    detector.markSeeded(workspace.id);

    return created;
  }

  timer = setInterval(() => void tick(), pollIntervalMs);
  if (typeof timer.unref === "function") timer.unref();
  // Run one cycle immediately so a freshly-started server catches
  // changes that happened while it was down.
  void tick();

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    scanWorkspace,
    stats,
  };
}

async function trySnapshot(
  store: SnapshotStore,
  _detector: AgentEditDetector,
  workspace: WorkspaceInfo,
  relPath: string,
  absPath: string,
  size: number,
  logger: { warn: (msg: string) => void },
): Promise<boolean> {
  if (size > AGENT_SNAPSHOT_MAX_BYTES) {
    logger.warn(
      `[agent-edit-poller] skipping oversized file ${relPath} (${size} B)`,
    );
    return false;
  }
  if (size === 0) {
    // Empty file — there's nothing useful to snapshot. Just record
    // the deletion of the prior content as a no-op in our model.
    return false;
  }

  let buf: Buffer;
  try {
    buf = await readFile(absPath);
  } catch (err) {
    logger.warn(
      `[agent-edit-poller] readFile failed for ${relPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }

  if (looksLikeBinary(buf)) {
    return false;
  }

  // Phase 6.9 fix: stamp the most recent non-agent snapshot as
  // `parentSnapshotId` so the Review tab's diff is correct (it diffs
  // parent → current, not the agent snapshot → current). Without
  // this, every pending file shows "Initial version — no pre-AI
  // snapshot to diff against" in the UI.
  //
  // We use `findLatestNonAgent` (not the trigger-less `findLatest`)
  // so we don't accidentally pick up the agent snapshot we are
  // about to save — that would create a self-referential parent
  // and the reject path would restore the same AI content it just
  // wrote.
  let parentSnapshotId: string | null = null;
  try {
    const latest = await store.findLatestNonAgent(workspace.id, relPath);
    if (latest) {
      parentSnapshotId = latest.id;
    }
  } catch (err) {
    // Non-fatal: a missing parent just means we can't offer reject.
    logger.warn(
      `[agent-edit-poller] findLatestNonAgent failed for ${relPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    const result = await store.save({
      workspaceId: workspace.id,
      filePath: relPath,
      content: buf.toString("utf8"),
      trigger: "agent",
      parentSnapshotId,
    });
    if (result.deduped) {
      return false;
    }
    // Best-effort audit; the snapshot is the source of truth.
    await recordAudit(workspace.path, {
      id: `audit_${Date.now().toString(36)}_${result.snapshot.id}`,
      workspaceId: workspace.id,
      actor: { type: "host" },
      action: "snapshot-auto",
      target: relPath,
      summary: `agent-snapshot of ${relPath} (${result.snapshot.size} B)`,
      timestamp: Date.now(),
    });
    return true;
  } catch (err) {
    logger.warn(
      `[agent-edit-poller] snapshot save failed for ${relPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

const BINARY_SNIFF_BYTES = 8 * 1024;
function looksLikeBinary(buf: Buffer): boolean {
  const sniff = buf.length > BINARY_SNIFF_BYTES ? buf.subarray(0, BINARY_SNIFF_BYTES) : buf;
  for (let i = 0; i < sniff.length; i += 1) {
    if (sniff[i] === 0) return true;
  }
  return false;
}
