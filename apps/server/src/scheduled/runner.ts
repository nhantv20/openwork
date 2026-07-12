/**
 * Scheduled-job execution engine (Phase 3 / M2 / S3).
 *
 * Implements the body of a scheduled fire:
 *  1. Create a fresh OpenCode session in the job's workspace.
 *  2. Send the prompt via `client.session.prompt`.
 *  3. Wait for the session to reach an idle/error state.
 *  4. Update the run row + parent job row with the result.
 *
 * Design notes:
 * - Pure function over injected deps. The server wires the real
 *   `createWorkspaceOpencodeClient` + `resolveWorkspace`; tests pass
 *   in-memory mocks.
 * - Skip-overlap (plan §4.1 #9): if a previous run is still `running`
 *   when this fire comes in, we write a `skipped_overlap` row and
 *   return early — without creating a new session.
 * - Per-job timeout (plan §5: 10 min) aborts the session if exceeded
 *   and marks the run as `failed` with a clear error message.
 * - `nextRunAt` is updated after every successful fire so the DB stays
 *   in sync with the schedule.
 */
import type { JobRun, ScheduledJob, ServerConfig, WorkspaceInfo } from "../types.js";
import type { ScheduledDb } from "./repo.js";

/** OpenCode SDK client surface we touch. Defined as a structural type so
 *  the runner can be tested with a tiny stub instead of importing the
 *  full SDK. */
export interface OpencodeJobClient {
  session: {
    create: (input: { title: string; agent?: string }) => Promise<{ id: string } | { error: unknown; response: Response }>;
    prompt: (input: {
      path: { id: string };
      body: { parts: Array<{ type: "text"; text: string }>; agent?: string };
    }) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
    abort: (input: { path: { id: string } }) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
  };
}

export interface JobRunnerDeps {
  config: ServerConfig;
  db: ScheduledDb;
  /** Resolve the workspace info for a job. Throws if the workspace was
   *  deleted between schedule and fire. */
  resolveWorkspace: (workspaceId: string) => Promise<WorkspaceInfo>;
  /** Build an OpenCode client for the given workspace. */
  getClient: (workspace: WorkspaceInfo) => OpencodeJobClient;
  /** Per-job execution timeout. Default 10 minutes (plan §5). */
  timeoutMs?: number;
  /** Override clock for tests. */
  now?: () => number;
  /** Logger. */
  log?: (message: string, context?: Record<string, unknown>) => void;
}

export const DEFAULT_JOB_TIMEOUT_MS = 10 * 60 * 1000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractSessionId(createResult: unknown): string | null {
  // The OpenCode SDK v2 returns `{ data, error, response }`. Some server
  // surfaces (e.g. mocks in tests) also unwrap the result. Accept both
  // shapes so we don't silently drop a freshly created session id.
  const candidates: unknown[] = isRecord(createResult) ? [createResult, createResult.data] : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const id = candidate.id;
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Public entry — wired by server.ts. The `Scheduler` calls this from
 *  its executor callback. */
export async function executeScheduledJob(
  job: ScheduledJob,
  scheduledFor: number,
  deps: JobRunnerDeps,
): Promise<JobRun> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((msg, ctx) => console.log(`[scheduler-runner] ${msg}`, ctx ?? ""));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;

  // Plan §4.1 #9: skip-overlap. If a previous run is still in flight for
  // this job, do not create a new session — record a `skipped_overlap`
  // row and return.
  const inflight = deps.db.countRunningRuns(job.id);
  if (inflight > 0) {
    log("skip-overlap: previous run still in flight", { jobId: job.id });
    const run = deps.db.createRun({ jobId: job.id, scheduledFor });
    return (
      deps.db.updateRun(run.id, {
        status: "skipped_overlap",
        finishedAt: now(),
        error: "Previous run was still in flight when this fire came in",
      }) ?? run
    );
  }

  const run = deps.db.createRun({ jobId: job.id, scheduledFor });
  let workspace: WorkspaceInfo;
  try {
    workspace = await deps.resolveWorkspace(job.workspaceId);
  } catch (err) {
    return (
      deps.db.updateRun(run.id, {
        status: "failed",
        finishedAt: now(),
        error: `Workspace not found: ${err instanceof Error ? err.message : String(err)}`,
      }) ?? run
    );
  }

  const client = deps.getClient(workspace);

  // 1) Create a session under the job's chosen OpenCode agent. Without an
  // explicit `agent` the engine returns 500 on the first prompt because
  // it can't resolve a primary agent for the empty session.
  let sessionId: string | null = null;
  try {
    const createResult = await client.session.create({ title: job.name, agent: job.agent });
    sessionId = extractSessionId(createResult);
  } catch (err) {
    return finalizeFailed(deps.db, run.id, now(), `session.create threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!sessionId) {
    return finalizeFailed(deps.db, run.id, now(), "session.create returned no id");
  }

  // 2) Mark run as running.
  deps.db.updateRun(run.id, { status: "running", startedAt: now(), sessionId });

  // Best-effort helper to abort the session on any failure path below.
  // Catches + swallows so an abort error never masks the original
  // failure that we're recording on the run row.
  const abortSession = () => {
    log("aborting session", { jobId: job.id, sessionId });
    client.session.abort({ path: { id: sessionId } }).catch(() => undefined);
  };

  // 3) Send the prompt under a timeout. On timeout, abort the session
  //    so the OpenCode engine stops consuming the job.
  let promptResult: { data?: unknown; error?: unknown; response: Response };
  try {
    promptResult = await withTimeout(
      client.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text: job.prompt }], agent: job.agent },
      }),
      timeoutMs,
      () => {
        log("job timeout — aborting session", { jobId: job.id, sessionId, timeoutMs });
        // The timeout branch already aborts; reuse the helper for the
        // log message + best-effort call so we don't drift.
        abortSession();
      },
    );
    log("session.prompt responded", {
      jobId: job.id,
      sessionId,
      status: promptResult.response?.status,
      hasError: Boolean(promptResult.error),
      hasData: Boolean(promptResult.data),
      errorName: isRecord(promptResult.error) ? String(promptResult.error.name ?? "") : "",
    });
  } catch (err) {
    abortSession();
    return finalizeFailed(deps.db, run.id, now(), `session.prompt threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4) Inspect the prompt result. The SDK returns
  //    `{ data, response }` on success or `{ error, response }` on failure.
  if (promptResult.error) {
    abortSession();
    return finalizeFailed(deps.db, run.id, now(), `session.prompt error: ${stringifyError(promptResult.error)}`);
  }

  // 5) Success — record outcome + bump the parent job.
  const finished = deps.db.updateRun(run.id, { status: "success", finishedAt: now() });
  deps.db.updateJob(job.id, {
    lastRunAt: now(),
    lastRunSessionId: sessionId,
  });
  log("job completed", { jobId: job.id, sessionId });
  return finished ?? run;
}

function finalizeFailed(
  db: ScheduledDb,
  runId: string,
  finishedAt: number,
  error: string,
): JobRun {
  const updated = db.updateRun(runId, { status: "failed", finishedAt, error });
  if (!updated) {
    // Should never happen — the row was created by createRun. Return a
    // synthetic JobRun so the type stays total.
    return {
      id: runId,
      jobId: "",
      scheduledFor: finishedAt,
      startedAt: null,
      finishedAt,
      status: "failed",
      sessionId: null,
      error,
    };
  }
  return updated;
}

function stringifyError(error: unknown): string {
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    if (typeof error.message === "string") return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return "[unserialisable error]";
    }
  }
  return String(error);
}

/** Promise.race with an abort hook. The abort fires when the timer
 *  elapses, so the caller can free upstream resources. */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
