/**
 * Unit tests for the scheduled-job execution engine (S3).
 *
 * Coverage:
 * - Skip-overlap: if a `running` run exists, write a `skipped_overlap`
 *   row and do NOT call the OpenCode client.
 * - Workspace not found → run marked `failed` with a clear message.
 * - session.create throws → run marked `failed`, no prompt attempted.
 * - session.create returns no id → run marked `failed`.
 * - session.prompt throws → run marked `failed`.
 * - session.prompt returns `error` field → run marked `failed` with
 *   serialised error message.
 * - Happy path: session created, prompt succeeds, run marked `success`,
 *   job's `lastRunAt` + `lastRunSessionId` updated.
 * - Timeout aborts the session + marks the run as `failed`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_JOB_TIMEOUT_MS,
  executeScheduledJob,
  type OpencodeJobClient,
} from "./runner.js";
import { __resetScheduledDbForTests, scheduledDb, type ScheduledDb } from "./repo.js";
import type { ScheduledJob, ServerConfig, WorkspaceInfo } from "../types.js";

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
let createdJob: ScheduledJob;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openwork-runner-test-"));
  process.env.OPENWORK_RUNTIME_DB = join(tmpDir, "runtime.sqlite");
  __resetScheduledDbForTests();
  db = await scheduledDb({ ...baseConfig });
  createdJob = await db.createJob({
    workspaceId: workspace.id,
    name: "Test job",
    prompt: "Summarise today",
    cronExpression: "*/5 * * * *",
    timezone: "Asia/Tokyo",
    agent: "build",
    model: null,
    enabled: true,
    nextRunAt: null,
  });
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  delete process.env.OPENWORK_RUNTIME_DB;
  __resetScheduledDbForTests();
});

function makeClient(overrides: Partial<OpencodeJobClient> = {}): {
  client: OpencodeJobClient;
  create: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (_input: { title?: string }) => ({ data: { id: "session-xyz" }, response: new Response() }));
  const prompt = vi.fn(async (_input: { sessionID: string; parts: Array<{ type: "text"; text: string }> }) => ({
    data: { ok: true },
    response: new Response(),
  }));
  const abort = vi.fn(async (_input: { sessionID: string }) => ({ data: { ok: true }, response: new Response() }));
  // Default workspace model — matches the in-app "use the workspace
  // default" flow. Tests that want to exercise the no-model branch
  // override `client.getDefaultModel = async () => null`.
  const getDefaultModel = vi.fn(async () => "fpt/DeepSeek-V4-Flash");
  const base: OpencodeJobClient = {
    session: { create, prompt, abort } as OpencodeJobClient["session"],
    getDefaultModel,
  };
  return {
    client: { ...base, ...overrides } as OpencodeJobClient,
    create,
    prompt,
    abort,
  };
}

const baseDeps = () => ({
  config: baseConfig,
  db,
  resolveWorkspace: async (_id: string) => workspace,
});

describe("executeScheduledJob — skip-overlap", () => {
  test("writes skipped_overlap when a previous run is still in flight", async () => {
    const prior = db.createRun({ jobId: createdJob.id, scheduledFor: Date.now() - 1000 });
    db.updateRun(prior.id, { status: "running", startedAt: Date.now() - 1000 });

    const { client, create, prompt } = makeClient();
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });

    expect(run.status).toBe("skipped_overlap");
    expect(run.error).toContain("Previous run was still in flight");
    expect(create).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();

    // The original prior run should NOT have been touched.
    const runs = db.listRuns(createdJob.id, 10);
    const priorAfter = runs.find((r) => r.id === prior.id);
    expect(priorAfter?.status).toBe("running");
  });
});

describe("executeScheduledJob — failure paths", () => {
  test("marks failed when workspace is not found", async () => {
    const { client, create } = makeClient();
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      resolveWorkspace: async () => {
        throw new Error("not in registry");
      },
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Workspace not found");
    expect(create).not.toHaveBeenCalled();
  });

  test("marks failed when session.create throws", async () => {
    const { client, create, prompt, abort } = makeClient();
    create.mockRejectedValueOnce(new Error("network down"));
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("session.create threw");
    expect(run.error).toContain("network down");
    expect(prompt).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  test("marks failed when session.create returns no id", async () => {
    const { client, create } = makeClient();
    // SDK v2 shape with empty id inside data.
    (create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { id: "" }, response: new Response() });
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("no id");
  });

  test("accepts both top-level id and SDK v2 { data: { id } } shape", async () => {
    // Regression: the runner used to read only `createResult.id`. The real
    // OpenCode SDK v2 returns `{ data: { id }, error, response }`, which
    // silently dropped every scheduled run. Verify both shapes are accepted.
    const { client, create, prompt } = makeClient();
    create.mockResolvedValueOnce({
      data: { id: "sdk-shape-id" },
      response: new Response(),
    } as never);
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("success");
    expect(run.sessionId).toBe("sdk-shape-id");
    expect(prompt).toHaveBeenCalled();
  });

  test("marks failed when session.prompt throws", async () => {
    const { client, prompt } = makeClient();
    prompt.mockRejectedValueOnce(new Error("stream broke"));
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("session.prompt threw");
    expect(run.error).toContain("stream broke");
  });

  test("marks failed when session.prompt returns error field", async () => {
    const { client, prompt } = makeClient();
    prompt.mockResolvedValueOnce({
      error: { message: "rate limited" },
      response: new Response(null, { status: 429 }),
    });
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("rate limited");
  });
});

describe("executeScheduledJob — happy path", () => {
  test("creates session, sends prompt, records success + updates job metadata", async () => {
    const { client, create, prompt, abort } = makeClient();
    const scheduledFor = Date.now();
    const run = await executeScheduledJob(createdJob, scheduledFor, {
      ...baseDeps(),
      getClient: () => client,
    });

    expect(run.status).toBe("success");
    expect(run.sessionId).toBe("session-xyz");
    expect(run.startedAt).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    // OpenCode SDK v2 SessionCreateData only accepts {parentID?, title?}.
    // Agent + model selection is forwarded on the subsequent prompt call.
    expect(create).toHaveBeenCalledWith({ title: "Test job" });
    // SDK v2: flat params at the top level.
    expect(prompt).toHaveBeenCalledWith({
      sessionID: "session-xyz",
      parts: [{ type: "text", text: "Summarise today" }],
      agent: "build",
      model: { providerID: "fpt", modelID: "DeepSeek-V4-Flash" },
    });
    expect(abort).not.toHaveBeenCalled();

    // Job's lastRunAt + lastRunSessionId are updated. The runner
    // calls `Date.now()` once for the run and once for the job, so we
    // allow up to a 5ms drift between the two timestamps.
    const jobAfter = await db.getJob(createdJob.id);
    expect(jobAfter?.lastRunSessionId).toBe("session-xyz");
    expect(jobAfter?.lastRunAt).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    expect(Math.abs((jobAfter?.lastRunAt ?? 0) - (run.finishedAt ?? 0))).toBeLessThan(5);
  });

  test("forwards explicit model override to session.create and session.prompt", async () => {
    const { client, create, prompt } = makeClient();
    const job = await db.createJob({
      workspaceId: createdJob.workspaceId,
      name: "modeled",
      prompt: "hello",
      cronExpression: createdJob.cronExpression,
      timezone: createdJob.timezone,
      agent: "build",
      model: "fpt/DeepSeek-V4-Flash",
      enabled: true,
      nextRunAt: null,
    });
    await executeScheduledJob(job, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(create).toHaveBeenCalledWith({ title: "modeled" });
    // SDK v2: flat params at the top level.
    expect(prompt).toHaveBeenCalledWith({
      sessionID: "session-xyz",
      parts: [{ type: "text", text: "hello" }],
      agent: "build",
      model: { providerID: "fpt", modelID: "DeepSeek-V4-Flash" },
    });
  });

  test("falls back to client.getDefaultModel() when job.model is null", async () => {
    const { client, create, prompt } = makeClient();
    client.getDefaultModel = async () => "fpt/DeepSeek-V4-Flash";
    await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(create).toHaveBeenCalledWith({ title: "Test job" });
    // SDK v2: flat params at the top level.
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { providerID: "fpt", modelID: "DeepSeek-V4-Flash" },
      }),
    );
  });

  test("fails the run when the stored model is malformed", async () => {
    const { client, create, prompt } = makeClient();
    const job = await db.createJob({
      workspaceId: createdJob.workspaceId,
      name: "bad-model",
      prompt: "hello",
      cronExpression: createdJob.cronExpression,
      timezone: createdJob.timezone,
      agent: "build",
      model: "not-a-valid-model",
      enabled: true,
      nextRunAt: null,
    });
    const run = await executeScheduledJob(job, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Invalid stored model");
    expect(create).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  test("fails the run with a helpful message when no model is available", async () => {
    const { client, create, prompt } = makeClient();
    // No explicit model, and getDefaultModel returns null (no
    // Config.model, no provider catalog).
    client.getDefaultModel = async () => null;
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("No model available");
    expect(create).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    // The parent job's lastRunAt should still be bumped so the user
    // sees a recent timestamp in the Settings list even on failure.
    const jobAfter = await db.getJob(createdJob.id);
    expect(jobAfter?.lastRunAt).not.toBeNull();
  });
});

describe("executeScheduledJob — session cleanup", () => {
  test("aborts the session when session.prompt throws", async () => {
    const { client, abort } = makeClient();
    (client.session.prompt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("stream died"),
    );
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    // Abort is best-effort, so we just check it was called with the
    // sessionId the runner created.
    expect(abort).toHaveBeenCalledWith({ sessionID: "session-xyz" });
  });

  test("aborts the session when session.prompt returns an error", async () => {
    const { client, prompt, abort } = makeClient();
    prompt.mockResolvedValueOnce({
      error: { message: "rate limited" },
      response: new Response(null, { status: 429 }),
    });
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("failed");
    expect(abort).toHaveBeenCalledWith({ sessionID: "session-xyz" });
  });

  test("does NOT abort the session on success", async () => {
    const { client, abort } = makeClient();
    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
    });
    expect(run.status).toBe("success");
    expect(abort).not.toHaveBeenCalled();
  });
});

describe("executeScheduledJob — timeout", () => {
  test("aborts session and marks failed when prompt exceeds timeoutMs", async () => {
    const { client, prompt, abort } = makeClient();
    // Never resolve → triggers the timeout path.
    (prompt as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {}),
    );

    const run = await executeScheduledJob(createdJob, Date.now(), {
      ...baseDeps(),
      getClient: () => client,
      timeoutMs: 50,
    });

    expect(run.status).toBe("failed");
    expect(run.error).toContain("Timed out after 50ms");
    expect(abort).toHaveBeenCalledWith({ sessionID: "session-xyz" });
  });

  test("DEFAULT_JOB_TIMEOUT_MS is 10 minutes (plan §5)", () => {
    expect(DEFAULT_JOB_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });
});
