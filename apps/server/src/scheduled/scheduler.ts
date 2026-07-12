/**
 * In-process cron scheduler (Phase 3 / M2 / S2).
 *
 * Loads `enabled=1` jobs from the repo on boot, registers a `croner.Cron`
 * instance per job, and fires the injected executor on every scheduled
 * trigger.
 *
 * Design notes:
 * - One Cron instance per job, keyed by job ID in an in-memory `Map`.
 *   The runner (S3) is injected via constructor; S2 only owns the
 *   cron registration + catch-up math.
 * - Catch-up: on `boot()` and after `registerJob()`, if `job.nextRunAt`
 *   is in the past and the gap is ≤ 5 min, we fire the executor once
 *   immediately. Gaps > 5 min create a `skipped` run row. This matches
 *   plan §3.4 + decision §4.1 #7.
 * - Stop semantics: `stop()` cancels every Cron and waits for any in-flight
 *   fire callbacks to settle. Used by server teardown.
 * - croner `protect: true` is the second layer of overlap protection
 *   (we also have skip-overlap at the run level — plan §4.1 #9).
 */
import { Cron } from "croner";

import type { ScheduledJob, ServerConfig } from "../types.js";
import { scheduledDb, type ScheduledDb } from "./repo.js";

/** Window (ms) after `nextRunAt` during which a missed run is still
 *  executed once. Plan §4.1 #7. */
export const CATCHUP_WINDOW_MS = 5 * 60 * 1000;

/** Callback fired by the scheduler when a job is due. The runner
 *  (S3) implements this to create a session + send the prompt. */
export type JobExecutor = (job: ScheduledJob, scheduledFor: number) => Promise<void>;

/** Surface used by the rest of the app (routes, S4) to mutate jobs and
 *  keep the scheduler in sync. */
export interface SchedulerApi {
  boot(): Promise<void>;
  stop(): Promise<void>;
  /** Register a new job (or re-register an updated one). Triggers catch-up
   *  check before scheduling. */
  registerJob(job: ScheduledJob): Promise<void>;
  /** Cancel + remove from in-memory map. */
  unregisterJob(id: string): Promise<void>;
  /** Re-derive schedule after an edit (cron/timezone/nextRunAt change). */
  rescheduleJob(job: ScheduledJob): Promise<void>;
  /** True if at least one fire is currently in flight. Used by tests. */
  isBusy(): boolean;
}

export interface SchedulerOptions {
  config: ServerConfig;
  executor: JobExecutor;
  /** Override the repo factory for tests. Defaults to `scheduledDb`. */
  db?: (config: ServerConfig) => Promise<ScheduledDb>;
  /** Override the clock for tests. */
  now?: () => number;
  /** Logger — defaults to `console`. */
  log?: (message: string, context?: Record<string, unknown>) => void;
}

export class Scheduler implements SchedulerApi {
  private readonly config: ServerConfig;
  private readonly executor: JobExecutor;
  private readonly getDb: (config: ServerConfig) => Promise<ScheduledDb>;
  private readonly now: () => number;
  private readonly log: (message: string, context?: Record<string, unknown>) => void;
  private readonly crons = new Map<string, Cron>();
  private readonly jobs = new Map<string, ScheduledJob>();
  private inflight = 0;
  private stopped = false;
  private dbPromise: Promise<ScheduledDb> | null = null;

  constructor(options: SchedulerOptions) {
    this.config = options.config;
    this.executor = options.executor;
    this.getDb = options.db ?? scheduledDb;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((msg, ctx) => console.log(`[scheduler] ${msg}`, ctx ?? ""));
  }

  private async db(): Promise<ScheduledDb> {
    if (!this.dbPromise) this.dbPromise = this.getDb(this.config);
    return this.dbPromise;
  }

  async boot(): Promise<void> {
    if (this.stopped) throw new Error("Scheduler is stopped");
    const db = await this.db();
    // Plan §3.4: clear zombie `running` runs left by a previous crash.
    const failed = db.failStaleRunningRuns();
    if (failed > 0) {
      this.log("failed stale running runs on boot", { count: failed });
    }
    const jobs = db.listEnabledJobs();
    for (const job of jobs) {
      await this.registerJob(job);
    }
    this.log("boot complete", { registeredJobs: jobs.length });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const cron of this.crons.values()) {
      cron.stop();
    }
    this.crons.clear();
    this.jobs.clear();
    // Wait for any in-flight fire callbacks to settle so the runner
    // can drain DB writes cleanly.
    const deadline = this.now() + 10_000;
    while (this.inflight > 0 && this.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    if (this.inflight > 0) {
      this.log("stop: in-flight runs did not drain within 10s", {
        inflight: this.inflight,
      });
    }
  }

  async registerJob(job: ScheduledJob): Promise<void> {
    if (this.stopped) return;
    if (!job.enabled) {
      // Defensive: enabled=0 jobs should never be registered, but skip
      // silently if the caller misuses the API.
      return;
    }
    // Cancel any previous registration for the same id.
    await this.unregisterJob(job.id);

    // Catch-up: if nextRunAt is in the past, decide whether to fire
    // immediately or record a skip.
    if (job.nextRunAt !== null) {
      const gap = this.now() - job.nextRunAt;
      if (gap > 0) {
        await this.handleCatchUp(job, job.nextRunAt, gap);
        // After catch-up, fall through and let croner schedule from the
        // updated nextRunAt (which the runner will recompute).
      }
    }

    const cron = new Cron(
      job.cronExpression,
      {
        timezone: job.timezone,
        protect: true,
        name: `job:${job.id}`,
      },
      async (self) => {
        if (this.stopped) return;
        // croner 10.x removed the `fireDate: Date` callback arg in favour
        // of `self: Cron<T>`. We pull the run timestamp off the instance.
        const fireDate = self.currentRun() ?? new Date(this.now());
        this.inflight++;
        try {
          await this.executor(job, fireDate.getTime());
        } catch (err) {
          this.log("executor threw", {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          this.inflight--;
        }
      },
    );
    this.crons.set(job.id, cron);
    this.jobs.set(job.id, job);
    this.log("registered job", { id: job.id, name: job.name, nextRunAt: cron.nextRun()?.toISOString() ?? null });
  }

  async unregisterJob(id: string): Promise<void> {
    const cron = this.crons.get(id);
    if (cron) {
      cron.stop();
      this.crons.delete(id);
    }
    this.jobs.delete(id);
  }

  async rescheduleJob(job: ScheduledJob): Promise<void> {
    if (!job.enabled) {
      await this.unregisterJob(job.id);
      return;
    }
    await this.registerJob(job);
  }

  isBusy(): boolean {
    return this.inflight > 0;
  }

  /** Test-only: peek the in-memory job registry. */
  __getRegisteredJob(id: string): ScheduledJob | undefined {
    return this.jobs.get(id);
  }

  /** Test-only: number of cron instances currently held. */
  __cronCount(): number {
    return this.crons.size;
  }

  private async handleCatchUp(
    job: ScheduledJob,
    scheduledFor: number,
    gap: number,
  ): Promise<void> {
    const db = await this.db();
    if (gap <= CATCHUP_WINDOW_MS) {
      // ≤ 5 min: fire once immediately.
      this.log("catch-up: firing missed run", { jobId: job.id, gapMs: gap });
      this.inflight++;
      try {
        await this.executor(job, scheduledFor);
      } catch (err) {
        this.log("catch-up executor threw", {
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.inflight--;
      }
      return;
    }
    // > 5 min: write a `skipped` run row for audit, do not fire.
    const run = db.createRun({ jobId: job.id, scheduledFor });
    db.updateRun(run.id, {
      status: "skipped",
      finishedAt: this.now(),
      error: `Catch-up window exceeded (gap ${Math.round(gap / 1000)}s > ${CATCHUP_WINDOW_MS / 1000}s)`,
    });
    this.log("catch-up: skipped missed run", {
      jobId: job.id,
      gapMs: gap,
    });
  }
}

/* ---------- Module-level singleton (used by server.ts) ---------- */

let activeScheduler: Scheduler | null = null;

export function setActiveScheduler(scheduler: Scheduler | null): void {
  activeScheduler = scheduler;
}

export function getActiveScheduler(): Scheduler | null {
  return activeScheduler;
}
