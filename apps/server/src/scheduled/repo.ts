/**
 * Scheduled jobs store (Phase 3 / M2).
 *
 * Persists cron jobs and their run history in `runtime.sqlite` (the same
 * SQLite file used by `file-snapshots.ts`, `session-groups.ts`, etc.).
 *
 * Design notes:
 * - Mirrors the pattern from `openwork-workspace-config-store.ts`: Drizzle
 *   for the Bun path (type-safe queries), raw prepared statements for the
 *   `node:sqlite` fallback so the compiled binary works on systems without
 *   Bun.
 * - Schema lives in the module, not in a separate migration file — matches
 *   the repo's "CREATE TABLE IF NOT EXISTS on first open" convention.
 * - WAL mode + `synchronous = NORMAL` mirrors `file-snapshots.ts:523` so the
 *   scheduler poll loop can read while the runner writes.
 * - `next_run_at` is denormalized + kept in sync by the scheduler. The
 *   repository treats it as write-through only; the runner is the source of
 *   truth for scheduling math.
 */
import { and, desc, eq } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { JobRun, JobRunStatus, ScheduledJob, ServerConfig } from "../types.js";
import { ensureDir, shortId } from "../utils.js";

/* ---------- Drizzle schema (Bun path) ---------- */

const scheduledJobs = sqliteTable(
  "scheduled_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),
    lastRunSessionId: text("last_run_session_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    workspaceIdx: index("idx_scheduled_jobs_workspace").on(table.workspaceId, table.enabled),
    nextRunIdx: index("idx_scheduled_jobs_next_run").on(table.enabled, table.nextRunAt),
  }),
);

const jobRuns = sqliteTable(
  "scheduled_job_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    scheduledFor: integer("scheduled_for").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    status: text("status").notNull(),
    sessionId: text("session_id"),
    error: text("error"),
  },
  (table) => ({
    jobIdx: index("idx_job_runs_job").on(table.jobId, table.scheduledFor),
  }),
);

/* ---------- Type-safe row → domain mapping ---------- */

type ScheduledJobRow = {
  id: string;
  workspaceId: string;
  name: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  createdAt: number;
  updatedAt: number;
};

type JobRunRow = {
  id: string;
  jobId: string;
  scheduledFor: number;
  startedAt: number | null;
  finishedAt: number | null;
  status: string;
  sessionId: string | null;
  error: string | null;
};

function rowToScheduledJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    prompt: row.prompt,
    cronExpression: row.cronExpression,
    timezone: row.timezone,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastRunSessionId: row.lastRunSessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToJobRun(row: JobRunRow): JobRun {
  // Validate status at the read boundary; unknown values fall back to
  // "failed" so the UI doesn't crash on legacy data.
  const validStatuses: JobRunStatus[] = [
    "pending",
    "running",
    "success",
    "failed",
    "skipped",
    "skipped_overlap",
  ];
  const status = (validStatuses as string[]).includes(row.status)
    ? (row.status as JobRunStatus)
    : "failed";
  return {
    id: row.id,
    jobId: row.jobId,
    scheduledFor: row.scheduledFor,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status,
    sessionId: row.sessionId,
    error: row.error,
  };
}

/* ---------- DB handle interface (Bun + Node) ---------- */

export interface ScheduledDb {
  listJobs(workspaceId?: string): ScheduledJob[];
  getJob(id: string): ScheduledJob | null;
  createJob(input: {
    workspaceId: string;
    name: string;
    prompt: string;
    cronExpression: string;
    timezone: string;
    enabled: boolean;
    nextRunAt: number | null;
  }): ScheduledJob;
  updateJob(
    id: string,
    patch: Partial<{
      name: string;
      prompt: string;
      cronExpression: string;
      timezone: string;
      enabled: boolean;
      nextRunAt: number | null;
      lastRunAt: number | null;
      lastRunSessionId: string | null;
    }>,
  ): ScheduledJob | null;
  deleteJob(id: string): boolean;
  listEnabledJobs(): ScheduledJob[];

  createRun(input: { jobId: string; scheduledFor: number }): JobRun;
  updateRun(
    id: string,
    patch: Partial<{
      startedAt: number;
      finishedAt: number;
      status: JobRunStatus;
      sessionId: string;
      error: string | null;
    }>,
  ): JobRun | null;
  listRuns(jobId: string, limit: number): JobRun[];
  /** Mark any `running` run as `failed` — used on server boot to clean up
   *  zombie runs left by a previous crash. */
  failStaleRunningRuns(): number;
  /** Count of `running` runs for a job — used for skip-overlap (plan §4.1 #9). */
  countRunningRuns(jobId: string): number;
}

/* ---------- Path resolution ---------- */

function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.OPENWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "openwork");
  return join(configDir, "runtime.sqlite");
}

/* ---------- Bun path (Drizzle) ---------- */

async function openBunDb(path: string): Promise<ScheduledDb> {
  await ensureDir(dirname(path));
  const { Database } = await import("bun:sqlite");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const sqlite = new Database(path, { create: true });

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      next_run_at INTEGER,
      last_run_at INTEGER,
      last_run_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      scheduled_for INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      status TEXT NOT NULL,
      session_id TEXT,
      error TEXT
    )
  `);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_workspace ON scheduled_jobs(workspace_id, enabled)`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(enabled, next_run_at)`);
  sqlite.run(`CREATE INDEX IF NOT EXISTS idx_job_runs_job ON scheduled_job_runs(job_id, scheduled_for)`);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");

  const db = drizzle(sqlite);

  return {
    listJobs: (workspaceId) => {
      const rows = workspaceId
        ? db
            .select()
            .from(scheduledJobs)
            .where(eq(scheduledJobs.workspaceId, workspaceId))
            .orderBy(desc(scheduledJobs.createdAt))
            .all()
        : db.select().from(scheduledJobs).orderBy(desc(scheduledJobs.createdAt)).all();
      return rows.map((r) => rowToScheduledJob(r as ScheduledJobRow));
    },
    getJob: (id) => {
      const row = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
      return row ? rowToScheduledJob(row as ScheduledJobRow) : null;
    },
    createJob: (input) => {
      const now = Date.now();
      const id = shortId();
      db.insert(scheduledJobs)
        .values({
          id,
          workspaceId: input.workspaceId,
          name: input.name,
          prompt: input.prompt,
          cronExpression: input.cronExpression,
          timezone: input.timezone,
          enabled: input.enabled,
          nextRunAt: input.nextRunAt,
          lastRunAt: null,
          lastRunSessionId: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const created = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
      if (!created) throw new Error(`Failed to read back scheduled job ${id}`);
      return rowToScheduledJob(created as ScheduledJobRow);
    },
    updateJob: (id, patch) => {
      const existing = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
      if (!existing) return null;
      db.update(scheduledJobs)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(scheduledJobs.id, id))
        .run();
      const updated = db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
      return updated ? rowToScheduledJob(updated as ScheduledJobRow) : null;
    },
    deleteJob: (id) => {
      // Drizzle's `.run()` on bun-sqlite returns `void`; we cannot read
      // `result.changes` here. Use a SELECT to confirm existence first.
      const existing = db.select({ id: scheduledJobs.id }).from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
      if (!existing) return false;
      // Also delete run history to keep the table tidy.
      db.delete(jobRuns).where(eq(jobRuns.jobId, id)).run();
      db.delete(scheduledJobs).where(eq(scheduledJobs.id, id)).run();
      return true;
    },
    listEnabledJobs: () => {
      const rows = db
        .select()
        .from(scheduledJobs)
        .where(eq(scheduledJobs.enabled, true))
        .all();
      return rows.map((r) => rowToScheduledJob(r as ScheduledJobRow));
    },
    createRun: ({ jobId, scheduledFor }) => {
      const id = shortId();
      db.insert(jobRuns)
        .values({
          id,
          jobId,
          scheduledFor,
          startedAt: null,
          finishedAt: null,
          status: "pending",
          sessionId: null,
          error: null,
        })
        .run();
      const created = db.select().from(jobRuns).where(eq(jobRuns.id, id)).get();
      if (!created) throw new Error(`Failed to read back job run ${id}`);
      return rowToJobRun(created as JobRunRow);
    },
    updateRun: (id, patch) => {
      const existing = db.select().from(jobRuns).where(eq(jobRuns.id, id)).get();
      if (!existing) return null;
      db.update(jobRuns).set(patch).where(eq(jobRuns.id, id)).run();
      const updated = db.select().from(jobRuns).where(eq(jobRuns.id, id)).get();
      return updated ? rowToJobRun(updated as JobRunRow) : null;
    },
    listRuns: (jobId, limit) => {
      const rows = db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.jobId, jobId))
        .orderBy(desc(jobRuns.scheduledFor))
        .limit(limit)
        .all();
      return rows.map((r) => rowToJobRun(r as JobRunRow));
    },
    failStaleRunningRuns: () => {
      // Drizzle's `.run()` returns void — count affected rows via SELECT.
      const affected = db
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(eq(jobRuns.status, "running"))
        .all();
      if (affected.length === 0) return 0;
      db
        .update(jobRuns)
        .set({ status: "failed", error: "Server restarted while run was in flight", finishedAt: Date.now() })
        .where(eq(jobRuns.status, "running"))
        .run();
      return affected.length;
    },
    countRunningRuns: (jobId) => {
      const rows = db
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.jobId, jobId), eq(jobRuns.status, "running")))
        .all();
      return rows.length;
    },
  };
}

/* ---------- Node path (raw SQL) ---------- */

function openNodeDb(path: string): ScheduledDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      next_run_at INTEGER,
      last_run_at INTEGER,
      last_run_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      scheduled_for INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      status TEXT NOT NULL,
      session_id TEXT,
      error TEXT
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_workspace ON scheduled_jobs(workspace_id, enabled)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(enabled, next_run_at)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_job_runs_job ON scheduled_job_runs(job_id, scheduled_for)`);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  const selectColumns = "id, workspace_id AS workspaceId, name, prompt, cron_expression AS cronExpression, timezone, enabled, next_run_at AS nextRunAt, last_run_at AS lastRunAt, last_run_session_id AS lastRunSessionId, created_at AS createdAt, updated_at AS updatedAt";

  const stmtListAll = sqlite.prepare(`SELECT ${selectColumns} FROM scheduled_jobs ORDER BY created_at DESC`);
  const stmtListByWorkspace = sqlite.prepare(`SELECT ${selectColumns} FROM scheduled_jobs WHERE workspace_id = ? ORDER BY created_at DESC`);
  const stmtListEnabled = sqlite.prepare(`SELECT ${selectColumns} FROM scheduled_jobs WHERE enabled = 1`);
  const stmtGet = sqlite.prepare(`SELECT ${selectColumns} FROM scheduled_jobs WHERE id = ?`);
  const stmtInsertJob = sqlite.prepare(
    "INSERT INTO scheduled_jobs (id, workspace_id, name, prompt, cron_expression, timezone, enabled, next_run_at, last_run_at, last_run_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
  );
  const stmtUpdateJob = sqlite.prepare(
    "UPDATE scheduled_jobs SET name = COALESCE(?, name), prompt = COALESCE(?, prompt), cron_expression = COALESCE(?, cron_expression), timezone = COALESCE(?, timezone), enabled = COALESCE(?, enabled), next_run_at = ?, last_run_at = ?, last_run_session_id = ?, updated_at = ? WHERE id = ?",
  );
  const stmtDeleteJob = sqlite.prepare("DELETE FROM scheduled_jobs WHERE id = ?");
  const stmtDeleteRuns = sqlite.prepare("DELETE FROM scheduled_job_runs WHERE job_id = ?");

  const runColumns = "id, job_id AS jobId, scheduled_for AS scheduledFor, started_at AS startedAt, finished_at AS finishedAt, status, session_id AS sessionId, error";
  const stmtInsertRun = sqlite.prepare(
    `INSERT INTO scheduled_job_runs (id, job_id, scheduled_for, started_at, finished_at, status, session_id, error) VALUES (?, ?, ?, NULL, NULL, 'pending', NULL, NULL)`,
  );
  const stmtGetRun = sqlite.prepare(`SELECT ${runColumns} FROM scheduled_job_runs WHERE id = ?`);
  const stmtUpdateRun = sqlite.prepare(
    "UPDATE scheduled_job_runs SET started_at = COALESCE(?, started_at), finished_at = COALESCE(?, finished_at), status = COALESCE(?, status), session_id = COALESCE(?, session_id), error = ? WHERE id = ?",
  );
  const stmtListRuns = sqlite.prepare(
    `SELECT ${runColumns} FROM scheduled_job_runs WHERE job_id = ? ORDER BY scheduled_for DESC LIMIT ?`,
  );
  const stmtFailStale = sqlite.prepare(
    "UPDATE scheduled_job_runs SET status = 'failed', error = 'Server restarted while run was in flight', finished_at = ? WHERE status = 'running'",
  );
  const stmtCountRunning = sqlite.prepare(
    "SELECT COUNT(*) AS n FROM scheduled_job_runs WHERE job_id = ? AND status = 'running'",
  );

  const toJob = (row: unknown): ScheduledJob | null => {
    if (!isRecord(row)) return null;
    return {
      id: String(row.id),
      workspaceId: String(row.workspaceId),
      name: String(row.name),
      prompt: String(row.prompt),
      cronExpression: String(row.cronExpression),
      timezone: String(row.timezone),
      enabled: Boolean(row.enabled),
      nextRunAt: row.nextRunAt == null ? null : Number(row.nextRunAt),
      lastRunAt: row.lastRunAt == null ? null : Number(row.lastRunAt),
      lastRunSessionId: row.lastRunSessionId == null ? null : String(row.lastRunSessionId),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    };
  };

  const toRun = (row: unknown): JobRun | null => {
    if (!isRecord(row)) return null;
    return rowToJobRun({
      id: String(row.id),
      jobId: String(row.jobId),
      scheduledFor: Number(row.scheduledFor),
      startedAt: row.startedAt == null ? null : Number(row.startedAt),
      finishedAt: row.finishedAt == null ? null : Number(row.finishedAt),
      status: String(row.status),
      sessionId: row.sessionId == null ? null : String(row.sessionId),
      error: row.error == null ? null : String(row.error),
    });
  };

  return {
    listJobs: (workspaceId) => {
      const rows = workspaceId ? stmtListByWorkspace.all(workspaceId) : stmtListAll.all();
      return rows.map(toJob).filter((j): j is ScheduledJob => j !== null);
    },
    getJob: (id) => toJob(stmtGet.get(id)),
    createJob: (input) => {
      const now = Date.now();
      const id = shortId();
      stmtInsertJob.run(
        id,
        input.workspaceId,
        input.name,
        input.prompt,
        input.cronExpression,
        input.timezone,
        input.enabled ? 1 : 0,
        input.nextRunAt,
        now,
        now,
      );
      const created = toJob(stmtGet.get(id));
      if (!created) throw new Error(`Failed to read back scheduled job ${id}`);
      return created;
    },
    updateJob: (id, patch) => {
      const existing = toJob(stmtGet.get(id));
      if (!existing) return null;
      stmtUpdateJob.run(
        patch.name ?? null,
        patch.prompt ?? null,
        patch.cronExpression ?? null,
        patch.timezone ?? null,
        patch.enabled == null ? null : patch.enabled ? 1 : 0,
        patch.nextRunAt === undefined ? existing.nextRunAt : patch.nextRunAt,
        patch.lastRunAt === undefined ? existing.lastRunAt : patch.lastRunAt,
        patch.lastRunSessionId === undefined ? existing.lastRunSessionId : patch.lastRunSessionId,
        Date.now(),
        id,
      );
      return toJob(stmtGet.get(id));
    },
    deleteJob: (id) => {
      // Delete runs first to keep the table clean.
      stmtDeleteRuns.run(id);
      const result = stmtDeleteJob.run(id);
      return result.changes > 0;
    },
    listEnabledJobs: () =>
      stmtListEnabled
        .all()
        .map(toJob)
        .filter((j): j is ScheduledJob => j !== null),
    createRun: ({ jobId, scheduledFor }) => {
      const id = shortId();
      stmtInsertRun.run(id, jobId, scheduledFor);
      const created = toRun(stmtGetRun.get(id));
      if (!created) throw new Error(`Failed to read back job run ${id}`);
      return created;
    },
    updateRun: (id, patch) => {
      const existing = toRun(stmtGetRun.get(id));
      if (!existing) return null;
      stmtUpdateRun.run(
        patch.startedAt ?? null,
        patch.finishedAt ?? null,
        patch.status ?? null,
        patch.sessionId ?? null,
        patch.error ?? null,
        id,
      );
      return toRun(stmtGetRun.get(id));
    },
    listRuns: (jobId, limit) =>
      stmtListRuns
        .all(jobId, limit)
        .map(toRun)
        .filter((r): r is JobRun => r !== null),
    failStaleRunningRuns: () => {
      // node:sqlite's `.run().changes` is typed as `number | bigint`.
      const result = stmtFailStale.run(Date.now());
      const n = result.changes;
      return typeof n === "bigint" ? Number(n) : n;
    },
    countRunningRuns: (jobId) => {
      const row = stmtCountRunning.get(jobId);
      if (!isRecord(row)) return 0;
      // node:sqlite can return bigint for COUNT(*); coerce defensively.
      const n = row.n;
      if (typeof n === "bigint") return Number(n);
      return Number(n) || 0;
    },
  };
}

/* ---------- Module-level cache ---------- */

const dbByPath = new Map<string, Promise<ScheduledDb>>();

export async function scheduledDb(config: ServerConfig): Promise<ScheduledDb> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  const dbPromise = (async () => {
    if (typeof process.versions.bun === "string") {
      return openBunDb(path);
    }
    await ensureDir(dirname(path));
    return openNodeDb(path);
  })();
  dbByPath.set(path, dbPromise);
  return dbPromise;
}

/** Test-only: reset the DB cache between tests so each test gets a fresh
 *  in-memory DB. Not exported in production bundles. */
export function __resetScheduledDbForTests(): void {
  dbByPath.clear();
}
