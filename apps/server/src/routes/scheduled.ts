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
const MAX_AGENT_LENGTH = 64;
const MAX_MODEL_LENGTH = 200;

/** OpenCode ships with two built-in agents. Custom agents from
 *  `~/.config/opencode/agent/*.md` would also be accepted, but we keep
 *  the allowlist tight to surface typos at create-time instead of
 *  failing later inside the engine. */
const DEFAULT_AGENT = "build";
const KNOWN_AGENTS = new Set<string>([DEFAULT_AGENT, "plan"]);

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
      agent: job.agent,
      model: job.model,
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

  // GET /api/scheduled/models?workspaceId=...
  // Returns the model list + workspace default for the create/edit dialog.
  // Best-effort: when the OpenCode engine doesn't expose providers or
  // errors, we still return an empty list so the UI degrades gracefully
  // (the user just keeps the existing `null` model and the runner falls
  // back to whatever the engine resolves at run-time).
  addRoute(routes, "GET", "/api/scheduled/models", "client", async (ctx) => {
    const workspaceId = ctx.url.searchParams.get("workspaceId");
    if (!workspaceId || !workspaceId.trim()) {
      throw new ApiError(400, "invalid_body", "workspaceId is required");
    }
    const workspace = await resolveWorkspace(config, workspaceId.trim());
    const client = getOpencodeClient(workspace);
    const models: Array<{
      value: string;
      label: string;
      providerLabel: string;
      isDefault: boolean;
    }> = [];

    let defaultModel: string | null = null;
    if (client.getDefaultModel) {
      try {
        const def = await client.getDefaultModel();
        defaultModel = def ?? null;
      } catch {
        defaultModel = null;
      }
    }

    // Try to enumerate the provider catalog. We don't depend on this
    // shape; the client may or may not expose it.
    const sdk = client as unknown as {
      provider?: { list?: () => Promise<unknown> };
      config?: { providers?: () => Promise<unknown> };
    };
    const providerListPromise = sdk.provider?.list?.();
    if (providerListPromise) {
      try {
        const result = await providerListPromise;
        const data = isRecord(result) ? result.data : undefined;
        const all = isRecord(data) && Array.isArray(data.all) ? data.all : [];
        const defaultMap = isRecord(data) && isRecord(data.default) ? data.default : {};
        for (const provider of all) {
          if (!isRecord(provider)) continue;
          const providerID = String(provider.id ?? "").trim();
          if (!providerID) continue;
          const providerName = String(provider.name ?? providerID);
          const providerModels = isRecord(provider.models) ? provider.models : {};
          for (const [modelID, def] of Object.entries(providerModels)) {
            if (!modelID) continue;
            const modelName = isRecord(def) ? String(def.name ?? modelID) : modelID;
            const value = `${providerID}/${modelID}`;
            const isDefault = String(defaultMap[providerID] ?? "") === modelID || defaultModel === value;
            models.push({
              value,
              label: modelName,
              providerLabel: providerName,
              isDefault,
            });
          }
        }
      } catch {
        // Swallow — empty list is the documented fallback.
      }
    }
    // Stable sort: default first, then provider + model label.
    models.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.providerLabel !== b.providerLabel) return a.providerLabel.localeCompare(b.providerLabel);
      return a.label.localeCompare(b.label);
    });
    return jsonResponse({ models, defaultModel });
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
    const agent = asString(body.agent ?? DEFAULT_AGENT, "agent", MAX_AGENT_LENGTH);
    if (!KNOWN_AGENTS.has(agent)) {
      throw new ApiError(400, "invalid_agent", `Unknown agent '${agent}'`, {
        allowed: Array.from(KNOWN_AGENTS),
      });
    }
    // Model is optional. When omitted, the runner resolves the workspace
    // default at run-time. Pass through `null` so DB stores SQL NULL.
    const rawModel = body.model;
    let model: string | null = null;
    if (typeof rawModel === "string" && rawModel.trim().length > 0) {
      const trimmed = rawModel.trim();
      if (trimmed.length > MAX_MODEL_LENGTH) {
        throw new ApiError(400, "invalid_body", `model must be at most ${MAX_MODEL_LENGTH} characters`);
      }
      // Validate shape — `providerID/modelID`. Existence in the provider
      // catalog is checked at run-time so we don't break when the
      // workspace adds a new provider after the job is saved.
      if (!/^[^/\s]+\/[^/\s]+(?:\?[^/\s]+)?$/.test(trimmed)) {
        throw new ApiError(
          400,
          "invalid_model",
          `model must be in 'providerID/modelID' form, got '${trimmed}'`,
        );
      }
      model = trimmed;
    } else if (rawModel !== undefined && rawModel !== null) {
      throw new ApiError(400, "invalid_body", "model must be a string or null");
    }
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
      agent,
      model,
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
    const newAgent = asOptionalString(body.agent, "agent", MAX_AGENT_LENGTH);
    if (newAgent !== undefined) {
      if (!KNOWN_AGENTS.has(newAgent)) {
        throw new ApiError(400, "invalid_agent", `Unknown agent '${newAgent}'`, {
          allowed: Array.from(KNOWN_AGENTS),
        });
      }
      patch.agent = newAgent;
    }
    // Model is special: it accepts `null` to clear the override, an
    // omitted key to leave the stored value, or a `"providerID/modelID"`
    // string to set it. We can't reuse `asOptionalString` because that
    // conflates "missing" with "null".
    if (Object.prototype.hasOwnProperty.call(body, "model")) {
      const raw = body.model;
      if (raw === null) {
        patch.model = null;
      } else if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          patch.model = null;
        } else {
          if (trimmed.length > MAX_MODEL_LENGTH) {
            throw new ApiError(400, "invalid_body", `model must be at most ${MAX_MODEL_LENGTH} characters`);
          }
          if (!/^[^/\s]+\/[^/\s]+(?:\?[^/\s]+)?$/.test(trimmed)) {
            throw new ApiError(
              400,
              "invalid_model",
              `model must be in 'providerID/modelID' form, got '${trimmed}'`,
            );
          }
          patch.model = trimmed;
        }
      } else {
        throw new ApiError(400, "invalid_body", "model must be a string or null");
      }
    }

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
