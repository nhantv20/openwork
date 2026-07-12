/**
 * Phase 6.7 — Agent edit detector.
 *
 * Heuristic classifier that distinguishes "this file was just written
 * by an HTTP request to our own server" (the snapshot middleware will
 * already have created a snapshot) from "this file was written by
 * something else — OpenCode session, external editor, CI script, …"
 * (in which case the polling layer should create a snapshot with
 * trigger="agent").
 *
 * Strategy: every HTTP write handler calls `markHttpWrite(workspaceId,
 * filePath)` BEFORE writing. The poller then calls `classifyChange()`
 * for every file it sees with a newer mtime than the last poll.
 *   - If the path is in the recent-writes map → "http" → skip (the
 *     middleware will have handled it).
 *   - Otherwise → "agent" → snapshot.
 *
 * The recent-writes map has a TTL (10s, deliberately 2× the default
 * poll interval of 5s) so the HTTP write is still classified as
 * "http" even if the poller's first cycle lands after the middleware
 * has already snapshotted. Without the TTL, fast HTTP writes would
 * sometimes be double-snapshotted.
 */
import type { ServerConfig } from "./types.js";

/** 2× the default poll interval. See module docstring. */
const RECENT_WRITE_TTL_MS = 10_000;

/** How often the poller prunes expired entries. */
const CLEANUP_INTERVAL_MS = 30_000;

type FileStat = { mtimeMs: number; size: number };

type WorkspaceState = {
  recentHttpWrites: Map<string, number>;
  lastSeen: Map<string, FileStat>;
  hasSeeded: boolean;
};

export type ChangeKind = "http" | "agent";

export class AgentEditDetector {
  private readonly states = new Map<string, WorkspaceState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(_config: ServerConfig) {
    // _config kept on the constructor for symmetry with other
    // server-side stores; not used yet.
    this.startCleanupLoop();
  }

  /** Mark a file as having been written via the server's own HTTP
   * write handlers. Callers MUST invoke this BEFORE the write lands
   * on disk so the polling cycle sees the marker. */
  markHttpWrite(workspaceId: string, filePath: string, now: number = Date.now()): void {
    this.workspace(workspaceId).recentHttpWrites.set(filePath, now);
  }

  /**
   * Classify a freshly observed file change.
   *
   * `mtimeMs` and `size` are the values the poller just read. If the
   * change is the result of an HTTP write, this returns "http" so the
   * poller skips it (the middleware already snapshotted). Otherwise
   * "agent" — the file was modified by something the server doesn't
   * know about, and the poller should snapshot it with trigger="agent".
   */
  classifyChange(
    workspaceId: string,
    filePath: string,
    now: number = Date.now(),
  ): ChangeKind {
    const state = this.workspace(workspaceId);
    const ts = state.recentHttpWrites.get(filePath);
    if (ts !== undefined && now - ts < RECENT_WRITE_TTL_MS) {
      // Consume the marker so the same write isn't double-counted on
      // the next poll cycle if the middleware's snapshot was the
      // reason the file mtime changed.
      state.recentHttpWrites.delete(filePath);
      return "http";
    }
    return "agent";
  }

  /** Record what we last saw for a file. Called after every poll
   * regardless of classification so we have a baseline for the next
   * round. */
  recordLastSeen(workspaceId: string, filePath: string, stat: FileStat): void {
    this.workspace(workspaceId).lastSeen.set(filePath, stat);
  }

  /** Look up the previously-seen stat, or `null` if first sighting. */
  getLastSeen(workspaceId: string, filePath: string): FileStat | null {
    return this.workspace(workspaceId).lastSeen.get(filePath) ?? null;
  }

  /** Drop a file from the lastSeen map (e.g. after deletion). */
  forget(workspaceId: string, filePath: string): void {
    this.workspace(workspaceId).lastSeen.delete(filePath);
  }

  /** Iterate the lastSeen keys for tests / introspection. */
  trackedFiles(workspaceId: string): string[] {
    return [...this.workspace(workspaceId).lastSeen.keys()];
  }

  /** Has the poller already done a full first-pass scan for this
   * workspace? Use this rather than `trackedFiles(...).length === 0`
   * to decide whether to seed the baseline — the latter is wrong for
   * empty workspaces (they'd never stop looking "first-scan"). */
  hasSeeded(workspaceId: string): boolean {
    return this.workspace(workspaceId).hasSeeded;
  }

  /** Mark a workspace as having completed its first scan. Callers
   * (the poller) should invoke this once after the initial walk so
   * subsequent scans know to diff against a real baseline. */
  markSeeded(workspaceId: string): void {
    this.workspace(workspaceId).hasSeeded = true;
  }

  /** Stop the cleanup loop. Server shutdown should call this. */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private workspace(workspaceId: string): WorkspaceState {
    let state = this.states.get(workspaceId);
    if (!state) {
      state = {
        recentHttpWrites: new Map(),
        lastSeen: new Map(),
        hasSeeded: false,
      };
      this.states.set(workspaceId, state);
    }
    return state;
  }

  private startCleanupLoop(): void {
    this.cleanupTimer = setInterval(() => this.prune(), CLEANUP_INTERVAL_MS);
    // Don't keep the event loop alive just for cleanup — shutdown
    // calls `stop()` explicitly.
    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  /** Test-accessible: prune expired recentHttpWrites. */
  prune(now: number = Date.now()): void {
    for (const state of this.states.values()) {
      for (const [path, ts] of state.recentHttpWrites) {
        if (now - ts >= RECENT_WRITE_TTL_MS) {
          state.recentHttpWrites.delete(path);
        }
      }
    }
  }
}
