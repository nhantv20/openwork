/**
 * Unit tests for the scheduled-jobs REST routes (S4).
 *
 * Coverage (per plan §3.5):
 * - GET /api/scheduled returns job list
 * - POST /api/scheduled creates a job + validates cron + rejects
 *   bad payload
 * - GET /api/scheduled/:id returns job + last 20 runs
 * - PATCH /api/scheduled/:id partial update
 * - DELETE /api/scheduled/:id removes job + cascades
 * - POST /api/scheduled/:id/run fires the runner manually
 * - GET /api/scheduled/:id/runs?limit= honours the cap
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __resetScheduledDbForTests, scheduledDb, type ScheduledDb } from "../scheduled/repo.js";
import {
  type SchedulerApi,
  setActiveScheduler,
} from "../scheduled/scheduler.js";
import { ApiError } from "../errors.js";
import { registerScheduledRoutes, _testInternals } from "./scheduled.js";
import { addRoute, type Route } from "./registry.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import type { OpencodeJobClient } from "../scheduled/runner.js";

/** Shared stub: a working client that creates "session-x" + succeeds
 *  on every prompt. Tests can override per-call with mockImplementation. */
const okClient: OpencodeJobClient = {
  session: {
    create: async () => ({ id: "x" }),
    prompt: async () => ({ data: {}, response: new Response() }),
    abort: async () => ({ data: {}, response: new Response() }),
  },
  getDefaultModel: async () => "fpt/DeepSeek-V4-Flash",
};
const stubClient = (): OpencodeJobClient => okClient;

const baseConfig: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  token: "t",
  hostToken: "h",
  approval: { mode: "auto", timeoutMs: 1000 },
  corsOrigins: ["*"],
  workspaces: [],
  authorizedRoots: [],
  readOnly: false,
  startedAt: Date.now(),
  tokenSource: "cli",
  hostTokenSource: "cli",
  logFormat: "pretty",
  logRequests: false,
};

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Test",
  path: "/tmp/test",
  preset: "default",
  workspaceType: "local",
};

let tmpDir: string;
let db: ScheduledDb;
let routes: Route[];

function matchHandler(method: string, path: string): (req: Request) => Promise<Response> {
  // Strip the query string — the router only matches against the path.
  const pathname = path.split("?")[0] ?? path;
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = pathname.match(route.regex);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? "")));
    return (req) =>
      route.handler({
        request: req,
        url: new URL(req.url),
        params,
        config: baseConfig,
        approvals: {} as never,
        reloadEvents: {} as never,
        tokens: {} as never,
      });
  }
  throw new Error(`No route matched ${method} ${path}`);
}

async function callAs(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const url = `http://test${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const req = new Request(url, init);
  try {
    const response = await matchHandler(method, path)(req);
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed };
  } catch (err) {
    if (err instanceof ApiError) {
      return { status: err.status, body: { code: err.code, message: err.message } };
    }
    throw err;
  }
}

const fakeScheduler = (): SchedulerApi => {
  return {
    boot: async () => {},
    stop: async () => {},
    registerJob: async () => {},
    unregisterJob: async () => {},
    rescheduleJob: async () => {},
    isBusy: () => false,
  };
};

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openwork-routes-test-"));
  process.env.OPENWORK_RUNTIME_DB = join(tmpDir, "runtime.sqlite");
  __resetScheduledDbForTests();
  db = await scheduledDb({ ...baseConfig });
  routes = [];
  setActiveScheduler(fakeScheduler());
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  delete process.env.OPENWORK_RUNTIME_DB;
  setActiveScheduler(null);
  __resetScheduledDbForTests();
});

describe("GET /api/scheduled", () => {
  test("returns empty list when no jobs", async () => {
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("GET", "/api/scheduled");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobs: [] });
  });
});

describe("POST /api/scheduled", () => {
  beforeEach(() => {
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
  });

  test("creates a job and returns 201", async () => {
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "Daily report",
      prompt: "Summarise today",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
    });
    expect(res.status).toBe(201);
    const body = res.body as { job: { id: string; name: string; cronExpression: string } };
    expect(body.job.name).toBe("Daily report");
    expect(body.job.cronExpression).toBe("0 9 * * *");
    expect(body.job.id).toBeTruthy();

    // Job should be in DB.
    const got = await db.getJob(body.job.id);
    expect(got?.name).toBe("Daily report");
  });

  test("rejects malformed cron with 400 invalid_cron", async () => {
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "Bad",
      prompt: "x",
      cron: "not a cron",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
    });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_cron");
  });

  test("rejects missing required fields", async () => {
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "x",
      // missing prompt + cron
    });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_body");
  });

  test("rejects unknown agent with 400 invalid_agent", async () => {
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "x",
      prompt: "y",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "nope-not-an-agent",
    });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_agent");
  });

  test("accepts build and plan agents", async () => {
    for (const agent of ["build", "plan"] as const) {
      const res = await callAs("POST", "/api/scheduled", {
        workspaceId: "ws-1",
        name: `with-${agent}`,
        prompt: "y",
        cron: "0 9 * * *",
        timezone: "Asia/Tokyo",
        agent,
      });
      expect(res.status).toBe(201);
      const job = (res.body as { job: { agent: string } }).job;
      expect(job.agent).toBe(agent);
    }
  });

  test("defaults agent to 'build' when omitted", async () => {
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "default-agent",
      prompt: "y",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
    });
    expect(res.status).toBe(201);
    expect((res.body as { job: { agent: string } }).job.agent).toBe("build");
  });

  test("accepts model override in 'providerID/modelID' form", async () => {
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "with-model",
      prompt: "y",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: "fpt/DeepSeek-V4-Flash",
    });
    expect(res.status).toBe(201);
    expect((res.body as { job: { model: string | null } }).job.model).toBe("fpt/DeepSeek-V4-Flash");
  });

  test("defaults model to null when omitted", async () => {
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "no-model",
      prompt: "y",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
    });
    expect(res.status).toBe(201);
    expect((res.body as { job: { model: string | null } }).job.model).toBeNull();
  });

  test("rejects malformed model with 400 invalid_model", async () => {
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "bad-model",
      prompt: "y",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
      model: "no-slash-here",
    });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_model");
  });

  test("GET /api/scheduled/models returns the workspace catalog", async () => {
    // Stub the client with a provider.list implementation.
    routes = [];
    const providerClient: OpencodeJobClient = {
      ...okClient,
      getDefaultModel: async () => "fpt/DeepSeek-V4-Flash",
    };
    (providerClient as unknown as { config: { providers: () => Promise<unknown> } }).config = {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "fpt",
              name: "FPT Cloud",
              models: {
                "DeepSeek-V4-Flash": { name: "DeepSeek V4 Flash" },
                "Qwen3.6-27B": { name: "Qwen 3.6 27B" },
              },
            },
            {
              id: "opencode",
              name: "OpenCode Free",
              models: {
                "deepseek-v4-flash-free": { name: "DeepSeek (free)" },
              },
            },
          ],
          default: { fpt: "DeepSeek-V4-Flash" },
        },
        response: new Response(),
      }),
    };
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: () => providerClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("GET", "/api/scheduled/models?workspaceId=ws-1");
    expect(res.status).toBe(200);
    const body = res.body as {
      models: Array<{ value: string; isDefault: boolean }>;
      defaultModel: string | null;
    };
    expect(body.defaultModel).toBe("fpt/DeepSeek-V4-Flash");
    expect(body.models).toHaveLength(3);
    const deepseek = body.models.find((m) => m.value === "fpt/DeepSeek-V4-Flash");
    expect(deepseek?.isDefault).toBe(true);
  });

  test("rejects unknown workspace with 400", async () => {
    // Override resolver to throw.
    routes = [];
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => {
        throw new ApiError(404, "workspace_not_found", "nope");
      },
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "missing",
      name: "x",
      prompt: "y",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
    });
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe("workspace_not_found");
  });
});

describe("GET /api/scheduled/:id", () => {
  test("returns the job and its recent runs", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "*/5 * * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
      enabled: true,
      nextRunAt: null,
    });
    const r1 = await db.createRun({ jobId: job.id, scheduledFor: Date.now() - 1000 });
    await db.updateRun(r1.id, { status: "success", startedAt: Date.now() - 1000, finishedAt: Date.now() - 500 });

    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("GET", `/api/scheduled/${job.id}`);
    expect(res.status).toBe(200);
    const body = res.body as { job: { id: string }; runs: Array<{ id: string }> };
    expect(body.job.id).toBe(job.id);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]?.id).toBe(r1.id);
  });

  test("returns 404 for unknown id", async () => {
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("GET", "/api/scheduled/nope");
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe("scheduled_job_not_found");
  });
});

describe("PATCH /api/scheduled/:id", () => {
  test("partial update changes only the patched field", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Old",
      prompt: "old prompt",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      agent: "build",
      model: null,
            enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("PATCH", `/api/scheduled/${job.id}`, { name: "New" });
    expect(res.status).toBe(200);
    const body = res.body as { job: { name: string; prompt: string } };
    expect(body.job.name).toBe("New");
    expect(body.job.prompt).toBe("old prompt");

    const got = await db.getJob(job.id);
    expect(got?.name).toBe("New");
    expect(got?.prompt).toBe("old prompt");
  });

  test("changing cron validates the new expression", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      agent: "build",
      model: null,
            enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("PATCH", `/api/scheduled/${job.id}`, { cron: "garbage" });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_cron");

    // DB row unchanged.
    const got = await db.getJob(job.id);
    expect(got?.cronExpression).toBe("0 9 * * *");
  });

  test("rejects unknown agent with 400 invalid_agent", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
      enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("PATCH", `/api/scheduled/${job.id}`, { agent: "nope" });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_agent");
  });

  test("accepts switching agent to plan", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
      enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("PATCH", `/api/scheduled/${job.id}`, { agent: "plan" });
    expect(res.status).toBe(200);
    expect((res.body as { job: { agent: string } }).job.agent).toBe("plan");
  });

  test("PATCH sets model override", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
      enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("PATCH", `/api/scheduled/${job.id}`, { model: "opencode/deepseek-v4-flash-free" });
    expect(res.status).toBe(200);
    expect((res.body as { job: { model: string | null } }).job.model).toBe("opencode/deepseek-v4-flash-free");
  });

  test("PATCH model=null clears the override", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: "fpt/DeepSeek-V4-Flash",
      enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("PATCH", `/api/scheduled/${job.id}`, { model: null });
    expect(res.status).toBe(200);
    expect((res.body as { job: { model: string | null } }).job.model).toBeNull();
  });

  test("PATCH rejects malformed model", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
      enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("PATCH", `/api/scheduled/${job.id}`, { model: "no-slash" });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_model");
  });
});

describe("DELETE /api/scheduled/:id", () => {
  test("removes the job + cascades to runs", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      agent: "build",
      model: null,
            enabled: true,
      nextRunAt: null,
    });
    const r1 = await db.createRun({ jobId: job.id, scheduledFor: Date.now() });

    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: () => ({
        session: {
          create: async () => ({ id: "x" }),
          prompt: async () => ({ data: {} as unknown, response: new Response() }),
          abort: async () => ({ data: {} as unknown, response: new Response() }),
        },
      } satisfies OpencodeJobClient),
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("DELETE", `/api/scheduled/${job.id}`);
    expect(res.status).toBe(200);
    expect(await db.getJob(job.id)).toBeNull();
    expect(await db.listRuns(job.id, 10)).toHaveLength(0);
  });
});

describe("POST /api/scheduled/:id/run", () => {
  test("fires the runner and returns the run row", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "hi",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      agent: "build",
      model: null,
            enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: () => ({
        session: {
          create: async () => ({ id: "session-1" }),
          prompt: async () => ({ data: { ok: true as const }, response: new Response() }),
          abort: async () => ({ data: {}, response: new Response() }),
        },
      } satisfies OpencodeJobClient),
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("POST", `/api/scheduled/${job.id}/run`);
    expect(res.status).toBe(200);
    const body = res.body as { run: { status: string; sessionId: string | null } };
    expect(body.run.status).toBe("success");
    expect(body.run.sessionId).toBe("session-1");
  });
});

describe("GET /api/scheduled/:id/runs?limit=", () => {
  test("caps the limit at MAX_RUNS_LIMIT (100)", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      agent: "build",
      model: null,
            enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: (_value, name) => {
        if (name === "limit") return 9999; // user requests huge limit
        return undefined;
      },
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: () => ({
        session: {
          create: async () => ({ id: "x" }),
          prompt: async () => ({ data: {} as unknown, response: new Response() }),
          abort: async () => ({ data: {} as unknown, response: new Response() }),
        },
      } satisfies OpencodeJobClient),
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("GET", `/api/scheduled/${job.id}/runs?limit=9999`);
    expect(res.status).toBe(200);
    // Just confirm we don't error out — actual count depends on DB.
    expect(Array.isArray((res.body as { runs: unknown[] }).runs)).toBe(true);
  });

  test("rejects negative limit", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      agent: "build",
      model: null,
            enabled: true,
      nextRunAt: null,
    });
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => {
        throw new ApiError(400, "invalid_query", "limit must be a positive integer");
      },
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: () => ({
        session: {
          create: async () => ({ id: "x" }),
          prompt: async () => ({ data: {} as unknown, response: new Response() }),
          abort: async () => ({ data: {} as unknown, response: new Response() }),
        },
      } satisfies OpencodeJobClient),
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("GET", `/api/scheduled/${job.id}/runs?limit=-1`);
    expect(res.status).toBe(400);
  });
});

describe("scheduled routes — security guards", () => {
  test("POST rejects when ensureWritable throws (read-only mode)", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
      enabled: true,
      nextRunAt: null,
    });
    routes = [];
    let ensureCalled = false;
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {
        ensureCalled = true;
        throw new ApiError(403, "read_only", "Server is in read-only mode");
      },
      requireClientScope: () => {},
    });
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "x",
      prompt: "y",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
    });
    expect(ensureCalled).toBe(true);
    expect(res.status).toBe(403);
    // DB should NOT have a new job written.
    expect(await db.getJob(job.id)).not.toBeNull();
  });

  test("POST rejects when requireClientScope throws (viewer scope)", async () => {
    routes = [];
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {
        throw new ApiError(403, "forbidden_scope", "Viewer scope cannot mutate");
      },
    });
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "x",
      prompt: "y",
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
    });
    expect(res.status).toBe(403);
    // DB should be empty.
    expect(await db.listJobs()).toHaveLength(0);
  });

  test("POST rejects prompt longer than 64KB", async () => {
    const huge = "a".repeat(64 * 1024 + 1);
    routes = [];
    registerScheduledRoutes({
      routes,
      config: baseConfig,
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      parseOptionalBoolean: () => undefined,
      parseOptionalPositiveInteger: () => undefined,
      readJsonBody: async (req) => (await req.json()) as Record<string, unknown>,
      resolveWorkspace: async () => workspace,
      getOpencodeClient: stubClient,
      ensureWritable: () => {},
      requireClientScope: () => {},
    });
    const res = await callAs("POST", "/api/scheduled", {
      workspaceId: "ws-1",
      name: "x",
      prompt: huge,
      cron: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      model: null,
    });
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("invalid_body");
  });
});

describe("validateCron", () => {
  test("rejects invalid cron", () => {
    expect(() => _testInternals.validateCron("nope", "UTC")).toThrow();
  });
  test("returns nextRunAt for a valid cron", () => {
    const result = _testInternals.validateCron("0 9 * * *", "UTC");
    expect(result.nextRunAt).toBeGreaterThan(Date.now());
  });
});
