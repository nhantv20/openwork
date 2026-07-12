/**
 * Unit tests for the in-process cron scheduler (S2).
 *
 * Coverage:
 * - boot() loads enabled jobs from repo + fails stale runs.
 * - registerJob / unregisterJob / rescheduleJob mutate the in-memory map.
 * - Catch-up: ≤5min gap fires once; >5min gap writes a `skipped` run row.
 * - Executor errors are caught (scheduler keeps running).
 * - stop() cancels crons and waits for in-flight fires.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CATCHUP_WINDOW_MS, Scheduler, type JobExecutor } from "./scheduler.js";
import { __resetScheduledDbForTests, scheduledDb, type ScheduledDb } from "./repo.js";
import type { ScheduledJob, ServerConfig } from "../types.js";

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

let tmpDir: string;
let db: ScheduledDb;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "openwork-scheduler-test-"));
  process.env.OPENWORK_RUNTIME_DB = join(tmpDir, "runtime.sqlite");
  __resetScheduledDbForTests();
  db = await scheduledDb({ ...baseConfig });
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

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const now = Date.now();
  return {
    id: "job-1",
    workspaceId: "ws-1",
    name: "Test",
    prompt: "hello",
    cronExpression: "0 9 * * *",
    timezone: "Asia/Tokyo",
    enabled: true,
    nextRunAt: null,
    lastRunAt: null,
    lastRunSessionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function createAndPersist(job: ScheduledJob): Promise<ScheduledJob> {
  return db.createJob({
    workspaceId: job.workspaceId,
    name: job.name,
    prompt: job.prompt,
    cronExpression: job.cronExpression,
    timezone: job.timezone,
    enabled: job.enabled,
    nextRunAt: job.nextRunAt,
  });
}

describe("Scheduler — boot", () => {
  test("boot() registers all enabled jobs and fails stale runs", async () => {
    // Seed: one enabled job + one disabled + one stale running run
    const enabled = await createAndPersist(makeJob({ name: "enabled" }));
    await createAndPersist(makeJob({ name: "disabled", id: "job-2", enabled: false }));
    const stale = db.createRun({ jobId: enabled.id, scheduledFor: Date.now() - 60_000 });
    db.updateRun(stale.id, { status: "running", startedAt: Date.now() - 60_000 });

    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();

    expect(scheduler.__cronCount()).toBe(1);
    expect(scheduler.__getRegisteredJob(enabled.id)?.name).toBe("enabled");

    const runs = db.listRuns(enabled.id, 10);
    const staleAfter = runs.find((r) => r.id === stale.id);
    expect(staleAfter?.status).toBe("failed");
    expect(staleAfter?.error).toContain("Server restarted");

    await scheduler.stop();
  });

  test("boot() with no jobs is a no-op", async () => {
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    expect(scheduler.__cronCount()).toBe(0);
    await scheduler.stop();
  });
});

describe("Scheduler — register/unregister", () => {
  test("registerJob adds to in-memory map", async () => {
    const job = makeJob();
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);

    expect(scheduler.__cronCount()).toBe(1);
    expect(scheduler.__getRegisteredJob(job.id)).toBeDefined();
    await scheduler.stop();
  });

  test("registerJob re-registers (cancels old cron first)", async () => {
    const job = makeJob();
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);
    await scheduler.registerJob({ ...job, name: "Renamed" });

    // Still only one cron for the same id.
    expect(scheduler.__cronCount()).toBe(1);
    expect(scheduler.__getRegisteredJob(job.id)?.name).toBe("Renamed");
    await scheduler.stop();
  });

  test("registerJob skips enabled=0 jobs (defensive)", async () => {
    const job = makeJob({ enabled: false });
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);
    expect(scheduler.__cronCount()).toBe(0);
    await scheduler.stop();
  });

  test("unregisterJob removes from map and stops the cron", async () => {
    const job = makeJob();
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);
    expect(scheduler.__cronCount()).toBe(1);

    await scheduler.unregisterJob(job.id);
    expect(scheduler.__cronCount()).toBe(0);
    expect(scheduler.__getRegisteredJob(job.id)).toBeUndefined();
    await scheduler.stop();
  });

  test("rescheduleJob with enabled=false unregisters", async () => {
    const job = makeJob();
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);
    expect(scheduler.__cronCount()).toBe(1);

    await scheduler.rescheduleJob({ ...job, enabled: false });
    expect(scheduler.__cronCount()).toBe(0);
    await scheduler.stop();
  });
});

describe("Scheduler — catch-up", () => {
  test("fires immediately when nextRunAt is ≤5min in the past", async () => {
    const past = Date.now() - 2 * 60 * 1000; // 2 min ago
    const job = makeJob({ nextRunAt: past });
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);

    // Catch-up is async; wait for it to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }), past);
    await scheduler.stop();
  });

  test("skips and writes a 'skipped' run when nextRunAt is >5min in the past", async () => {
    const past = Date.now() - (CATCHUP_WINDOW_MS + 60_000); // 6 min ago
    const job = makeJob({ nextRunAt: past });
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);

    await new Promise((r) => setTimeout(r, 50));
    expect(executor).not.toHaveBeenCalled();

    const runs = db.listRuns(job.id, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("skipped");
    expect(runs[0]?.error).toContain("Catch-up window exceeded");
    await scheduler.stop();
  });

  test("catch-up fires AT the scheduledFor time, not the current time", async () => {
    // The test pins down: when the server was down for 2 min, the fired
    // run is recorded for the *original* scheduledFor (used for
    // audit + next-run derivation downstream), not now.
    const past = Date.now() - 2 * 60 * 1000;
    const job = makeJob({ nextRunAt: past });
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);

    await new Promise((r) => setTimeout(r, 50));
    expect(executor).toHaveBeenCalledWith(expect.anything(), past);
    await scheduler.stop();
  });
});

describe("Scheduler — executor error handling", () => {
  test("executor errors do not crash the scheduler; subsequent fires still occur", async () => {
    // We can't easily wait for a real cron fire in a unit test without
    // mocking croner itself. Instead, simulate a direct fire by calling
    // registerJob with nextRunAt in the past and verifying the error
    // path is non-fatal.
    const past = Date.now() - 30_000;
    const job = makeJob({ nextRunAt: past });
    const executor = vi.fn<JobExecutor>(async () => {
      throw new Error("boom");
    });
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();

    // Should not throw.
    await scheduler.registerJob(job);
    await new Promise((r) => setTimeout(r, 50));

    expect(executor).toHaveBeenCalled();
    expect(scheduler.__cronCount()).toBe(1); // still registered
    await scheduler.stop();
  });
});

describe("Scheduler — stop", () => {
  test("stop() clears the in-memory map", async () => {
    const job = makeJob();
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.registerJob(job);
    expect(scheduler.__cronCount()).toBe(1);

    await scheduler.stop();
    expect(scheduler.__cronCount()).toBe(0);
  });

  test("registerJob is a no-op after stop()", async () => {
    const job = makeJob();
    const executor = vi.fn<JobExecutor>(async () => {});
    const scheduler = new Scheduler({ config: baseConfig, executor, db: () => Promise.resolve(db) });
    await scheduler.boot();
    await scheduler.stop();
    await scheduler.registerJob(job);
    expect(scheduler.__cronCount()).toBe(0);
  });
});
