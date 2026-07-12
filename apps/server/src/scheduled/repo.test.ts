/**
 * Unit tests for the scheduled jobs repository.
 *
 * Coverage:
 * - Job CRUD: create / get / list / update / delete
 * - List filtering by workspaceId
 * - listEnabledJobs() returns only `enabled=1` rows
 * - Run CRUD: create / update / list
 * - failStaleRunningRuns() marks `running` runs as `failed`
 * - countRunningRuns() returns correct count (used for skip-overlap)
 * - deleteJob() also clears the run history (no orphan rows)
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import {
  __resetScheduledDbForTests,
  scheduledDb,
  type ScheduledDb,
} from "./repo.js";
import type { ServerConfig } from "../types.js";

function makeConfig(): ServerConfig {
  // We rely on `OPENWORK_RUNTIME_DB` to point each test at a fresh tmp file,
  // so the per-path cache in `scheduledDb()` is bypassed.
  const dir = mkdtempSync(join(tmpdir(), "openwork-scheduled-test-"));
  const dbPath = join(dir, "runtime.sqlite");
  // Keep the dir handle alive so we can clean up at teardown.
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
  return {
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
}

let activeConfig: ServerConfig | null = null;
let activeCleanup: (() => void) | null = null;
let db: ScheduledDb;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "openwork-scheduled-test-"));
  activeCleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
  process.env.OPENWORK_RUNTIME_DB = join(dir, "runtime.sqlite");
  __resetScheduledDbForTests();
  activeConfig = makeConfig();
  db = await scheduledDb(activeConfig);
});

afterEach(() => {
  if (activeCleanup) activeCleanup();
  activeCleanup = null;
  activeConfig = null;
  delete process.env.OPENWORK_RUNTIME_DB;
  __resetScheduledDbForTests();
});

describe("scheduledDb — jobs", () => {
  test("createJob returns a job with generated id + timestamps", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Daily report",
      prompt: "Summarise today's git log",
      cronExpression: "0 9 * * *",
      timezone: "Asia/Tokyo",
      agent: "build",
      enabled: true,
      nextRunAt: Date.now() + 60_000,
    });

    expect(job.id).toBeTruthy();
    expect(job.workspaceId).toBe("ws-1");
    expect(job.name).toBe("Daily report");
    expect(job.cronExpression).toBe("0 9 * * *");
    expect(job.timezone).toBe("Asia/Tokyo");
    expect(job.enabled).toBe(true);
    expect(job.nextRunAt).not.toBeNull();
    expect(job.lastRunAt).toBeNull();
    expect(job.lastRunSessionId).toBeNull();
    expect(job.createdAt).toBeGreaterThan(0);
    expect(job.updatedAt).toBeGreaterThan(0);
    expect(job.createdAt).toBe(job.updatedAt);
  });

  test("getJob returns null for unknown id", async () => {
    const got = await db.getJob("does-not-exist");
    expect(got).toBeNull();
  });

  test("getJob returns the previously created job", async () => {
    const created = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "* * * * *",
      timezone: "UTC",
      agent: "build",
            enabled: true,
      nextRunAt: null,
    });
    const got = await db.getJob(created.id);
    expect(got).not.toBeNull();
    expect(got?.id).toBe(created.id);
    expect(got?.name).toBe("Test");
  });

  test("updateJob applies partial patch + bumps updatedAt", async () => {
    const created = await db.createJob({
      workspaceId: "ws-1",
      name: "Old name",
      prompt: "p",
      cronExpression: "* * * * *",
      timezone: "UTC",
      agent: "build",
            enabled: true,
      nextRunAt: null,
    });
    const originalUpdatedAt = created.updatedAt;

    // Wait 2ms so the bumped updatedAt is strictly greater.
    await new Promise((r) => setTimeout(r, 2));

    const updated = await db.updateJob(created.id, {
      name: "New name",
      enabled: false,
      lastRunAt: 123_456_789,
    });

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("New name");
    expect(updated?.enabled).toBe(false);
    expect(updated?.cronExpression).toBe("* * * * *"); // untouched
    expect(updated?.lastRunAt).toBe(123_456_789);
    expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  test("updateJob returns null for unknown id", async () => {
    const updated = await db.updateJob("nope", { name: "x" });
    expect(updated).toBeNull();
  });

  test("deleteJob removes the row + cascades to runs", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "* * * * *",
      timezone: "UTC",
      agent: "build",
            enabled: true,
      nextRunAt: null,
    });
    const run = await db.createRun({ jobId: job.id, scheduledFor: Date.now() });
    expect(await db.listRuns(job.id, 10)).toHaveLength(1);

    const deleted = await db.deleteJob(job.id);
    expect(deleted).toBe(true);

    expect(await db.getJob(job.id)).toBeNull();
    expect(await db.listRuns(job.id, 10)).toHaveLength(0);
    expect(run.id).toBeTruthy(); // keep linter happy about unused
  });

  test("deleteJob returns false for unknown id", async () => {
    const deleted = await db.deleteJob("nope");
    expect(deleted).toBe(false);
  });

  test("listJobs returns all jobs across workspaces when no filter", async () => {
    await db.createJob({ workspaceId: "ws-1", name: "A", prompt: "p", cronExpression: "* * * * *", timezone: "UTC", agent: "build", enabled: true, nextRunAt: null });
    await db.createJob({ workspaceId: "ws-2", name: "B", prompt: "p", cronExpression: "* * * * *", timezone: "UTC", agent: "build", enabled: true, nextRunAt: null });

    const all = await db.listJobs();
    expect(all).toHaveLength(2);
  });

  test("listJobs filters by workspaceId", async () => {
    await db.createJob({ workspaceId: "ws-1", name: "A", prompt: "p", cronExpression: "* * * * *", timezone: "UTC", agent: "build", enabled: true, nextRunAt: null });
    await db.createJob({ workspaceId: "ws-2", name: "B", prompt: "p", cronExpression: "* * * * *", timezone: "UTC", agent: "build", enabled: true, nextRunAt: null });

    const ws1 = await db.listJobs("ws-1");
    expect(ws1).toHaveLength(1);
    expect(ws1[0]?.workspaceId).toBe("ws-1");
  });

  test("listEnabledJobs returns only enabled rows", async () => {
    await db.createJob({ workspaceId: "ws-1", name: "A", prompt: "p", cronExpression: "* * * * *", timezone: "UTC", agent: "build", enabled: true, nextRunAt: null });
    await db.createJob({ workspaceId: "ws-1", name: "B", prompt: "p", cronExpression: "* * * * *", timezone: "UTC", agent: "build", enabled: false, nextRunAt: null });

    const enabled = await db.listEnabledJobs();
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.name).toBe("A");
  });
});

describe("scheduledDb — runs", () => {
  test("createRun initializes status='pending' and null timestamps", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "* * * * *",
      timezone: "UTC",
      agent: "build",
            enabled: true,
      nextRunAt: null,
    });
    const scheduledFor = Date.now();
    const run = await db.createRun({ jobId: job.id, scheduledFor });

    expect(run.jobId).toBe(job.id);
    expect(run.scheduledFor).toBe(scheduledFor);
    expect(run.status).toBe("pending");
    expect(run.startedAt).toBeNull();
    expect(run.finishedAt).toBeNull();
    expect(run.sessionId).toBeNull();
    expect(run.error).toBeNull();
  });

  test("updateRun transitions pending → running → success", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "* * * * *",
      timezone: "UTC",
      agent: "build",
            enabled: true,
      nextRunAt: null,
    });
    const run = await db.createRun({ jobId: job.id, scheduledFor: Date.now() });

    const running = await db.updateRun(run.id, {
      status: "running",
      startedAt: Date.now(),
    });
    expect(running?.status).toBe("running");
    expect(running?.startedAt).not.toBeNull();

    const done = await db.updateRun(run.id, {
      status: "success",
      finishedAt: Date.now(),
      sessionId: "session-abc",
    });
    expect(done?.status).toBe("success");
    expect(done?.finishedAt).not.toBeNull();
    expect(done?.sessionId).toBe("session-abc");
  });

  test("listRuns returns runs ordered by scheduledFor DESC and respects limit", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "* * * * *",
      timezone: "UTC",
      agent: "build",
            enabled: true,
      nextRunAt: null,
    });
    for (let i = 0; i < 5; i++) {
      await db.createRun({ jobId: job.id, scheduledFor: 1_000_000 + i * 1_000 });
    }

    const runs = await db.listRuns(job.id, 3);
    expect(runs).toHaveLength(3);
    // Newest first
    expect(runs[0]?.scheduledFor).toBe(1_004_000);
    expect(runs[1]?.scheduledFor).toBe(1_003_000);
    expect(runs[2]?.scheduledFor).toBe(1_002_000);
  });

  test("failStaleRunningRuns marks running runs as failed + returns count", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "* * * * *",
      timezone: "UTC",
      agent: "build",
            enabled: true,
      nextRunAt: null,
    });
    const r1 = await db.createRun({ jobId: job.id, scheduledFor: Date.now() });
    const r2 = await db.createRun({ jobId: job.id, scheduledFor: Date.now() });
    await db.updateRun(r1.id, { status: "running", startedAt: Date.now() });
    await db.updateRun(r2.id, { status: "running", startedAt: Date.now() });
    // Plus a finished one that should NOT be touched
    const r3 = await db.createRun({ jobId: job.id, scheduledFor: Date.now() });
    await db.updateRun(r3.id, { status: "success", startedAt: Date.now(), finishedAt: Date.now() });

    const count = await db.failStaleRunningRuns();
    expect(count).toBe(2);

    const runs = await db.listRuns(job.id, 10);
    const r1After = runs.find((r) => r.id === r1.id);
    const r2After = runs.find((r) => r.id === r2.id);
    const r3After = runs.find((r) => r.id === r3.id);
    expect(r1After?.status).toBe("failed");
    expect(r2After?.status).toBe("failed");
    expect(r3After?.status).toBe("success");
    expect(r1After?.error).toContain("Server restarted");
  });

  test("countRunningRuns returns the number of in-flight runs for a job", async () => {
    const job = await db.createJob({
      workspaceId: "ws-1",
      name: "Test",
      prompt: "p",
      cronExpression: "* * * * *",
      timezone: "UTC",
      agent: "build",
            enabled: true,
      nextRunAt: null,
    });
    expect(await db.countRunningRuns(job.id)).toBe(0);

    const r1 = await db.createRun({ jobId: job.id, scheduledFor: Date.now() });
    await db.updateRun(r1.id, { status: "running", startedAt: Date.now() });
    expect(await db.countRunningRuns(job.id)).toBe(1);

    const r2 = await db.createRun({ jobId: job.id, scheduledFor: Date.now() });
    await db.updateRun(r2.id, { status: "running", startedAt: Date.now() });
    expect(await db.countRunningRuns(job.id)).toBe(2);

    await db.updateRun(r1.id, { status: "success", finishedAt: Date.now() });
    expect(await db.countRunningRuns(job.id)).toBe(1);
  });
});
