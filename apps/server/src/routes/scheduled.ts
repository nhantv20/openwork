/**
 * REST routes for scheduled jobs (Phase 3 / M2 / S4).
 *
 * Mirrors the `registerSessionRoutes(options)` pattern from
 * `routes/sessions.ts`. Endpoints per plan §3.5:
 *
 *   GET    /api/scheduled?workspaceId=...       — list jobs
 *   POST   /api/scheduled                       — create job
 *   GET    /api/scheduled/:id                   — detail + last 20 runs
 *   PATCH  /api/scheduled/:id                   — partial update
 *   DELETE /api/scheduled/:id                   — delete
 *   POST   /api/scheduled/:id/run              — manual trigger
 *   GET    /api/scheduled/:id/runs?limit=...   — run history
 *
 * Auth: all routes require a client token (plan §3.5).
 *
 * The scheduler is consulted on every mutation so the in-memory cron
 * registry stays in sync with DB state. Wiring happens in server.ts
 * via `setActiveScheduler` (S2).
 */
import { Cron } from "croner";

import { ApiError } from "../errors.js";
import type { ScheduledJob, ServerConfig, TokenScope } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";
import { scheduledDb, type ScheduledDb } from "../scheduled/repo.js";
import {
  type SchedulerApi,
  getActiveScheduler,
} from "../scheduled/scheduler.js";
import {
  DEFAULT_JOB_TIMEOUT_MS,
  executeScheduledJob,
  type OpencodeJobClient,
} from "../scheduled/runner.js";
import type { WorkspaceInfo } from "../types.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ParseOptionalBoolean = (value: string | null, name: string) => boolean | undefined;
type ParseOptionalPositiveInteger = (value: string | null, name: string) => number | undefined;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;
type EnsureWritable = (config: ServerConfig) => void;
type RequireClientScope = (ctx: RequestContext, required: TokenScope) => void;

export interface RegisterScheduledRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  parseOptionalBoolean: ParseOptionalBoolean;
  parseOptionalPositiveInteger: ParseOptionalPositiveInteger;
  readJsonBody: ReadJsonBody;
  /** Lookup workspace by id — throws if missing. */
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  /** Build the OpenCode SDK client for a workspace. The runner is
   *  typed against `OpencodeJobClient` (structural), so any client with
   *  the three required methods works. */
  getOpencodeClient: (workspace: WorkspaceInfo) => OpencodeJobClient;
  /** Reject the request when the server is in read-only mode. Required
   *  for every mutate route (POST/PATCH/DELETE/run). */
  ensureWritable: EnsureWritable;
  /** Reject the request when the client token's scope is below
   *  `collaborator`. Required for every mutate route; GET routes keep
   *  the base `client` auth and skip this check. */
  requireClientScope: RequireClientScope;
  /** Override the DB factory for tests. Defaults to `scheduledDb`. */
  db?: (config: ServerConfig) => Promise<ScheduledDb>;
  /** Override the scheduler accessor for tests. Defaults to the
   *  module-level singleton set via `setActiveScheduler`. */
  getScheduler?: () => SchedulerApi | null;
  /** Override the job timeout (default 10min, plan §5). */
  jobTimeoutMs?: number;
}

const DEFAULT_RUNS_LIMIT = 20;
const MAX_RUNS_LIMIT = 100;

/** Length caps for free-text fields. Kept generous enough for any
 *  real prompt, but tight enough to defang a DoS attempt that floods
 *  the SQLite file with megabytes of garbage. */
const MAX_NAME_LENGTH = 200;
const MAX_PROMPT_LENGTH = 64 * 1024;
const MAX_CRON_LENGTH = 100;
const MAX_TIMEZONE_LENGTH = 64;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(value: unknown, field: string, maxLength: number = MAX_NAME_LENGTH): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_body", `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError(400, "invalid_body", `${field} must not be empty`);
  }
  if (trimmed.length > maxLength) {
    throw new ApiError(400, "invalid_body", `${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function asOptionalString(value: unknown, field: string, maxLength: number = MAX_NAME_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_body", `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new ApiError(400, "invalid_body", `${field} must be at most ${maxLength} characters`);
  }
  return trimmed || undefined;
}

function asOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ApiError(400, "invalid_body", `${field} must be a boolean`);
  }
  return value;
}

/** Parse a cron expression via croner; throw a 400 with a friendly
 *  message if it's malformed. Also verifies the timezone is parseable. */
function validateCron(cron: string, timezone: string): { nextRunAt: number | null } {
  try {
    const c = new Cron(cron, { timezone });
    const next = c.nextRun();
    return { nextRunAt: next ? next.getTime() : null };
  } catch (err) {
    throw new ApiError(
      400,
      "invalid_cron",
      err instanceof Error ? err.message : "Invalid cron expression",
    );
  }
}

function resolveDb(opts: RegisterScheduledRoutesOptions): Promise<ScheduledDb> {
  return (opts.db ?? scheduledDb)(opts.config);
}

function resolveScheduler(opts: RegisterScheduledRoutesOptions): SchedulerApi | null {
  return (opts.getScheduler ?? getActiveScheduler)();
}

export function registerScheduledRoutes(options: RegisterScheduledRoutesOptions): void {
  const {
    routes,
    config,
    jsonResponse,
    parseOptionalBoolean,
    parseOptionalPositiveInteger,
    readJsonBody,
    resolveWorkspace,
    getOpencodeClient,
    ensureWritable,
    requireClientScope,
  } = options;

  function jobToJson(job: ScheduledJob): Record<string, unknown> {
    return {
      id: job.id,
      workspaceId: job.workspaceId,
      name: job.name,
      prompt: job.prompt,
      cronExpression: job.cronExpression,
      timezone: job.timezone,
      enabled: job.enabled,
      nextRunAt: job.nextRunAt,
      lastRunAt: job.lastRunAt,
      lastRunSessionId: job.lastRunSessionId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  // GET /api/scheduled
  addRoute(routes, "GET", "/api/scheduled", "client", async (ctx) => {
    const db = await resolveDb(options);
    const workspaceId = ctx.url.searchParams.get("workspaceId");
    const jobs = workspaceId
      ? db.listJobs(workspaceId.trim() || undefined)
      : db.listJobs();
    return jsonResponse({ jobs: jobs.map(jobToJson) });
  });

  // POST /api/scheduled
  addRoute(routes, "POST", "/api/scheduled", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const body = await readJsonBody(ctx.request);
    const workspaceId = asString(body.workspaceId, "workspaceId", MAX_NAME_LENGTH);
    const name = asString(body.name, "name", MAX_NAME_LENGTH);
    const prompt = asString(body.prompt, "prompt", MAX_PROMPT_LENGTH);
    const cronExpression = asString(body.cron, "cron", MAX_CRON_LENGTH);
    const timezone = asString(body.timezone ?? "Asia/Tokyo", "timezone", MAX_TIMEZONE_LENGTH);
    // Validate workspace + cron BEFORE persisting so a bad request
    // never leaves a half-written job in DB.
    await resolveWorkspace(config, workspaceId);
    const { nextRunAt } = validateCron(cronExpression, timezone);

    const db = await resolveDb(options);
    const job = db.createJob({
      workspaceId,
      name,
      prompt,
      cronExpression,
      timezone,
      enabled: true,
      nextRunAt,
    });

    const scheduler = resolveScheduler(options);
    if (scheduler) {
      try {
        await scheduler.registerJob(job);
      } catch (err) {
        // Roll back the DB write so the user can retry without a
        // duplicate job.
        db.deleteJob(job.id);
        throw err;
      }
    }

    return jsonResponse({ job: jobToJson(job) }, 201);
  });

  // GET /api/scheduled/:id
  addRoute(routes, "GET", "/api/scheduled/:id", "client", async (ctx) => {
    const db = await resolveDb(options);
    const id = ctx.params.id ?? "";
    const job = db.getJob(id);
    if (!job) {
      throw new ApiError(404, "scheduled_job_not_found", "Scheduled job not found");
    }
    const runs = db.listRuns(job.id, DEFAULT_RUNS_LIMIT);
    return jsonResponse({ job: jobToJson(job), runs });
  });

  // PATCH /api/scheduled/:id
  addRoute(routes, "PATCH", "/api/scheduled/:id", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const db = await resolveDb(options);
    const id = ctx.params.id ?? "";
    const job = db.getJob(id);
    if (!job) {
      throw new ApiError(404, "scheduled_job_not_found", "Scheduled job not found");
    }
    const body = await readJsonBody(ctx.request);

    const patch: Parameters<typeof db.updateJob>[1] = {};
    const newCron = asOptionalString(body.cron, "cron", MAX_CRON_LENGTH);
    const newTimezone = asOptionalString(body.timezone, "timezone", MAX_TIMEZONE_LENGTH);
    const effectiveTimezone = newTimezone ?? job.timezone;

    if (newCron !== undefined || newTimezone !== undefined) {
      const { nextRunAt } = validateCron(newCron ?? job.cronExpression, effectiveTimezone);
      if (newCron !== undefined) patch.cronExpression = newCron;
      if (newTimezone !== undefined) patch.timezone = newTimezone;
      patch.nextRunAt = nextRunAt;
    }
    const newName = asOptionalString(body.name, "name", MAX_NAME_LENGTH);
    if (newName !== undefined) patch.name = newName;
    const newPrompt = asOptionalString(body.prompt, "prompt", MAX_PROMPT_LENGTH);
    if (newPrompt !== undefined) patch.prompt = newPrompt;
    const newEnabled = asOptionalBoolean(body.enabled, "enabled");
    if (newEnabled !== undefined) patch.enabled = newEnabled;

    const updated = db.updateJob(id, patch);
    if (!updated) {
      throw new ApiError(404, "scheduled_job_not_found", "Scheduled job not found");
    }
    const scheduler = resolveScheduler(options);
    if (scheduler) {
      await scheduler.rescheduleJob(updated);
    }
    return jsonResponse({ job: jobToJson(updated) });
  });

  // DELETE /api/scheduled/:id
  addRoute(routes, "DELETE", "/api/scheduled/:id", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const db = await resolveDb(options);
    const id = ctx.params.id ?? "";
    const job = db.getJob(id);
    if (!job) {
      throw new ApiError(404, "scheduled_job_not_found", "Scheduled job not found");
    }
    const scheduler = resolveScheduler(options);
    if (scheduler) {
      await scheduler.unregisterJob(id);
    }
    db.deleteJob(id);
    return jsonResponse({ ok: true });
  });

  // POST /api/scheduled/:id/run — manual trigger
  addRoute(routes, "POST", "/api/scheduled/:id/run", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const db = await resolveDb(options);
    const id = ctx.params.id ?? "";
    const job = db.getJob(id);
    if (!job) {
      throw new ApiError(404, "scheduled_job_not_found", "Scheduled job not found");
    }
    // Resolve workspace first so we fail fast if it's gone.
    const workspace = await resolveWorkspace(config, job.workspaceId);
    const run = await executeScheduledJob(job, Date.now(), {
      config,
      db,
      resolveWorkspace: (id) => resolveWorkspace(config, id),
      getClient: getOpencodeClient,
      timeoutMs: options.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
      // Suppress unused param warning for the workspace binding
      // (we already resolved it to fail fast on a missing workspace).
      ...(workspace ? {} : {}),
    });
    return jsonResponse({ run });
  });

  // GET /api/scheduled/:id/runs?limit=
  addRoute(routes, "GET", "/api/scheduled/:id/runs", "client", async (ctx) => {
    const db = await resolveDb(options);
    const id = ctx.params.id ?? "";
    const job = db.getJob(id);
    if (!job) {
      throw new ApiError(404, "scheduled_job_not_found", "Scheduled job not found");
    }
    const rawLimit = ctx.url.searchParams.get("limit");
    const parsedLimit = parseOptionalPositiveInteger(rawLimit, "limit");
    const limit = Math.min(parsedLimit ?? DEFAULT_RUNS_LIMIT, MAX_RUNS_LIMIT);
    const runs = db.listRuns(job.id, limit);
    return jsonResponse({ runs });
  });
}

/** Helper exported for the manual-trigger route — `body` shape is loose
 *  because it's keyed off `unknown`. Kept here so tests can reuse it. */
export const _testInternals = { validateCron, asString, asOptionalString, asOptionalBoolean, isRecord };
