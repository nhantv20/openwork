/**
 * Phase 1 — Opencode archive runner.
 *
 * Periodically invokes `scripts/opencode-archive/index.ts` to rotate
 * idle opencode sessions out of the live `opencode.db` into per-session
 * archive folders. See `scripts/opencode-archive/README.md` for the
 * archive layout and rationale.
 *
 * Why a poller, not an idle hook?
 *   - opencode's HTTP API does not expose a `session.idle` event
 *     (verified against opencode 1.17.18 — no SSE channel covers it).
 *   - The 24h interval is plenty for the "context-bloat mitigation"
 *     use-case: an idle session stays idle for days, so polling once
 *     a day is the same effective latency as a hook.
 *   - The poller survives opencode restarts because the archive
 *     script reads the DB fresh every run.
 *
 * Design:
 * - Spawns the script as a child Bun process — same-process would
 *   require sharing a SQLite handle, which is fragile.
 * - Logs the script's stdout/stderr if it exits non-zero or if any
 *   sessions were archived (so operators can see what's happening).
 * - Default interval is 24h, jittered ±10% so multiple OpenWork
 *   instances on the same network don't all fire at minute 0.
 * - First tick fires 60s after start so we don't slow server boot.
 * - Disabled when `OPENWORK_ARCHIVE_RUNNER=0` (escape hatch).
 *
 * Phase roadmap (see todos):
 *   - Phase 2: move archive folder from XDG-global to per-workspace
 *     `<workspace>/.opencode/archive/`.
 *   - Phase 3: listen to opencode's SSE event stream for real-time
 *     archive on `session.idle` (when/if opencode adds it).
 *   - Phase 4: workspace context isolation via opencode projectID
 *     filter on `additionalDirectories` (or FPT proxy fallback).
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ServerConfig } from "./types.js";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 60_000;
const JITTER_FRACTION = 0.1;
const MIN_TICK_GAP_MS = 60_000;

const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "scripts",
  "opencode-archive",
  "index.ts",
);

export type OpencodeArchiveRunnerHandle = {
  stop: () => void;
  /** Run an archive pass immediately, bypassing the timer. Returns
   *  the exit code (0 = success). Used by tests and ad-hoc triggers. */
  runOnce: () => Promise<number>;
};

export type OpencodeArchiveRunnerOptions = {
  config: ServerConfig;
  intervalMs?: number;
  logger?: {
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
};

function jitter(baseMs: number): number {
  const delta = baseMs * JITTER_FRACTION * (Math.random() * 2 - 1);
  return Math.max(MIN_TICK_GAP_MS, Math.round(baseMs + delta));
}

type RunResult = { code: number; stdout: string; stderr: string };

function runArchiveScript(signal: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ code: 130, stdout: "", stderr: "aborted" });
      return;
    }
    const proc = spawn("bun", [SCRIPT_PATH], {
      env: { ...process.env },
      signal,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    proc.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: stderr + (stderr ? "\n" : "") + err.message });
    });
  });
}

export function startOpencodeArchiveRunner(
  options: OpencodeArchiveRunnerOptions,
): OpencodeArchiveRunnerHandle {
  // Default ON in dev/test so OpenWork desktop users get auto-archive
  // out of the box. Set `OPENWORK_ARCHIVE_RUNNER=0` to disable.
  if (process.env.OPENWORK_ARCHIVE_RUNNER === "0") {
    options.logger?.info("[opencode-archive-runner] disabled via OPENWORK_ARCHIVE_RUNNER=0");
    return { stop: () => undefined, runOnce: async () => 0 };
  }

  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = options.logger;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;

  const handleRunOnce = async (): Promise<number> => {
    const result = await runArchiveScript(controller.signal);
    if (controller.signal.aborted || stopped) return result.code;
    if (result.code === 0) {
      const lines = result.stdout.trim().split("\n");
      const last = lines[lines.length - 1];
      if (last && last.startsWith("{")) {
        try {
          const report = JSON.parse(last) as {
            archivedThisRun?: number;
            hardDeletedThisRun?: number;
            bytesReclaimed?: number;
          };
          logger?.info(
            `[opencode-archive-runner] ok archived=${report.archivedThisRun ?? 0} hardDeleted=${report.hardDeletedThisRun ?? 0} bytesReclaimed=${report.bytesReclaimed ?? 0}`,
          );
          if ((report.archivedThisRun ?? 0) + (report.hardDeletedThisRun ?? 0) > 0) {
            logger?.info(`[opencode-archive-runner] full report:\n${last}`);
          }
        } catch {
          logger?.info("[opencode-archive-runner] ok (no report)");
        }
      } else {
        logger?.info("[opencode-archive-runner] ok (no report)");
      }
    } else {
      logger?.error(
        `[opencode-archive-runner] failed exit=${result.code} stderr=${result.stderr.trim() || "(empty)"}`,
      );
    }
    return result.code;
  };

  const tick = (): void => {
    if (running || stopped || controller.signal.aborted) return;
    running = true;
    void handleRunOnce()
      .catch((err) => {
        logger?.error(
          "[opencode-archive-runner] tick error",
          { error: err instanceof Error ? err.message : String(err) },
        );
      })
      .finally(() => {
        running = false;
        if (!stopped && !controller.signal.aborted) {
          timer = setTimeout(tick, jitter(intervalMs));
        }
      });
  };

  // First tick after a short delay so we don't slow server boot.
  timer = setTimeout(tick, FIRST_TICK_DELAY_MS);

  return {
    stop: () => {
      stopped = true;
      controller.abort();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    runOnce: handleRunOnce,
  };
}

// Re-export for tests / lazy callers
export { SCRIPT_PATH as OPENCODE_ARCHIVE_SCRIPT_PATH };
