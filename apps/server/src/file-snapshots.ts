/**
 * File-snapshot store (Phase 6: Version History).
 *
 * Persists per-file content snapshots in `runtime.sqlite` (the same SQLite
 * file used by `session-groups.ts`, `runtime-opencode-config-store.ts`, etc.).
 *
 * Design notes:
 * - Drizzle for type-safe schema, but we hand-write the `CREATE TABLE` SQL to
 *   match the existing pattern in `session-groups.ts` (Bun vs node:sqlite
 *   fallback). Schema lives in the store, not in a separate migration file —
 *   matches the repo's "CREATE TABLE IF NOT EXISTS on first open" convention.
 * - UNIQUE index on `(workspace_id, file_path, content_hash)` makes
 *   dedup-on-hash atomic at the storage layer. Callers use
 *   `INSERT ... ON CONFLICT DO NOTHING` to avoid races between concurrent
 *   writes (slice 6.2 auto-snapshot middleware relies on this).
 * - Content stored inline as TEXT. Cap at 5MB per snapshot (enforced by
 *   `MAX_SNAPSHOT_BYTES`). Files larger than this are the caller's
 *   responsibility to refuse (see `snapshot-middleware.ts` in slice 6.2).
 * - LRU trim to `SNAPSHOT_KEEP_LAST` (200) per file is the store's job;
 *   callers do not need to invoke `trim()` themselves — `save()` calls it
 *   after every successful insert.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { FileSnapshot, FileSnapshotStatus, FileSnapshotTrigger, ServerConfig } from "./types.js";
import { ensureDir, shortId } from "./utils.js";

/** Cap on a single snapshot's content. Larger files must be refused by the caller. */
export const MAX_SNAPSHOT_BYTES = 5_000_000;

/** LRU retention per (workspace, file). Oldest entries past this count are dropped on every save. */
export const SNAPSHOT_KEEP_LAST = 200;

const fileSnapshots = sqliteTable(
  "file_snapshots",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    filePath: text("file_path").notNull(),
    contentHash: text("content_hash").notNull(),
    content: text("content").notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at").notNull(),
    trigger: text("trigger").notNull(),
    revision: text("revision"),
    // Phase 6.9 (Review Tab): approval workflow columns. Both nullable so
    // legacy rows (pre-Phase 6.9) and non-agent triggers (auto, manual)
    // simply read back as null.
    status: text("status"),
    parentSnapshotId: text("parent_snapshot_id"),
  },
  (table) => ({
    /** Used by `list(workspaceId, filePath, {before})` and `findLatest`. */
    workspaceFileAtIdx: index("idx_snapshots_workspace_file").on(
      table.workspaceId,
      table.filePath,
      table.createdAt,
    ),
    /** Race-free dedup. Slice 6.2 middleware relies on this. */
    dedupIdx: uniqueIndex("idx_snapshots_dedup").on(
      table.workspaceId,
      table.filePath,
      table.contentHash,
    ),
    /** Phase 6.9: filter agent-triggered snapshots by approval status. */
    statusIdx: index("idx_snapshots_status").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
  }),
);

type SnapshotRow = {
  id: string;
  workspaceId: string;
  filePath: string;
  contentHash: string;
  content: string;
  size: number;
  createdAt: number;
  trigger: string;
  revision: string | null;
  status: string | null;
  parentSnapshotId: string | null;
};

type SnapshotDb = {
  save: (input: SnapshotRow) => { row: SnapshotRow; deduped: boolean };
  list: (
    workspaceId: string,
    filePath: string,
    opts: { limit: number; before?: number },
  ) => SnapshotRow[];
  findLatest: (workspaceId: string, filePath: string, trigger?: string) => SnapshotRow | null;
  getById: (workspaceId: string, snapshotId: string) => SnapshotRow | null;
  delete: (workspaceId: string, snapshotId: string) => boolean;
  count: (workspaceId: string, filePath?: string) => number;
  trim: (workspaceId: string, filePath: string, keepLast: number) => number;
  /** Phase 6.9: list every snapshot in a workspace matching a trigger + status filter. */
  listByStatus: (
    workspaceId: string,
    opts: { trigger: FileSnapshotTrigger; status: FileSnapshotStatus; limit: number; before?: number },
  ) => SnapshotRow[];
  /** L3 fix: list every agent-triggered snapshot (any status, including legacy NULL). */
  listAllAgent: (
    workspaceId: string,
    opts: { limit: number; before?: number },
  ) => SnapshotRow[];
  /**
   * Phase 6.9 hotfix: latest non-agent snapshot for a file. Used to
   * backfill `parentSnapshotId` on legacy agent rows and on the
   * response shape of the pending-approvals route. Triggers
   * considered: `auto`, `manual`.
   */
  findLatestNonAgent: (workspaceId: string, filePath: string) => SnapshotRow | null;
  /** Phase 6.9: mark a snapshot approved/pending/rejected. */
  setStatus: (
    workspaceId: string,
    snapshotId: string,
    status: FileSnapshotStatus,
  ) => SnapshotRow | null;
  /** Phase 6.9: stamp the pre-AI snapshot id onto a row (e.g. when an agent edit lands). */
  setParent: (workspaceId: string, snapshotId: string, parentSnapshotId: string | null) => void;
};

function rowToSnapshot(row: SnapshotRow): FileSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    filePath: row.filePath,
    contentHash: row.contentHash,
    content: row.content,
    size: row.size,
    createdAt: row.createdAt,
    // Phase 6.7: keep all three trigger values; only the legacy
    // shape (anything outside the whitelist) is normalised to "auto".
    trigger: isValidTrigger(row.trigger) ? row.trigger : "auto",
    revision: row.revision,
    // Phase 6.9: approval status. Maps null → undefined so legacy
    // rows and non-agent triggers don't carry a meaningless "pending"
    // marker into the wire payload.
    status: isValidStatus(row.status) ? row.status : undefined,
    // null parent = no pre-AI snapshot (first snapshot in a file, or
    // legacy row). Distinguishing null from missing keeps reject
    // logic safe: a missing parent row would otherwise be treated
    // identically and fail with a confusing "not found" error.
    parentSnapshotId: row.parentSnapshotId,
  };
}

function isValidTrigger(value: string): value is FileSnapshotTrigger {
  return value === "auto" || value === "manual" || value === "agent";
}

function isValidStatus(value: string | null): value is FileSnapshotStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

function normalizeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.OPENWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "openwork");
  return join(configDir, "runtime.sqlite");
}

async function openSnapshotDb(path: string): Promise<SnapshotDb> {
  await ensureDir(dirname(path));

  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run(`
      CREATE TABLE IF NOT EXISTS file_snapshots (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        revision TEXT
      )
    `);
    // Phase 6.9: approval workflow columns. Added via ALTER TABLE so
    // legacy databases created before the migration still upgrade
    // cleanly. Both columns are nullable: legacy rows stay status=null
    // / parent_snapshot_id=null, and the SELECT shape below already
    // uses coalesce-friendly accessors.
    const columnCheck = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM pragma_table_info('file_snapshots')",
      )
      .all();
    const columnNames = new Set(columnCheck.map((row) => row.name));
    if (!columnNames.has("status")) {
      sqlite.run("ALTER TABLE file_snapshots ADD COLUMN status TEXT");
    }
    if (!columnNames.has("parent_snapshot_id")) {
      sqlite.run("ALTER TABLE file_snapshots ADD COLUMN parent_snapshot_id TEXT");
    }
    sqlite.run(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_workspace_file
        ON file_snapshots(workspace_id, file_path, created_at)
    `);
    sqlite.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_dedup
        ON file_snapshots(workspace_id, file_path, content_hash)
    `);
    sqlite.run(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_status
        ON file_snapshots(workspace_id, status, created_at)
    `);
    // L3 fix: enable WAL journal mode so concurrent readers (e.g.
    // `listAgentSnapshots`) do not block on a writer holding the
    // `delete` journal lock. Without this, the read-only connection
    // we used to spin up per call would either busy-loop or error
    // out under load. WAL also gives us crash safety for free.
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA synchronous = NORMAL");
    const db = drizzle(sqlite);
    return {
      save: (input) => {
        try {
          db.insert(fileSnapshots).values(input).run();
          return { row: input, deduped: false };
        } catch (err) {
          // UNIQUE constraint violation = dedup hit
          if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
            const existing = db
              .select()
              .from(fileSnapshots)
              .where(
                and(
                  eq(fileSnapshots.workspaceId, input.workspaceId),
                  eq(fileSnapshots.filePath, input.filePath),
                  eq(fileSnapshots.contentHash, input.contentHash),
                ),
              )
              .get();
            if (existing) return { row: existing, deduped: true };
            throw err;
          }
          throw err;
        }
      },
      list: (workspaceId, filePath, opts) => {
        const baseWhere = and(
          eq(fileSnapshots.workspaceId, workspaceId),
          eq(fileSnapshots.filePath, filePath),
        );
        const where = opts.before !== undefined
          ? and(baseWhere, lt(fileSnapshots.createdAt, opts.before))
          : baseWhere;
        return db
          .select()
          .from(fileSnapshots)
          .where(where)
          .orderBy(desc(fileSnapshots.createdAt))
          .limit(opts.limit)
          .all();
      },
      findLatest: (workspaceId, filePath, trigger) => {
        const where = [
          eq(fileSnapshots.workspaceId, workspaceId),
          eq(fileSnapshots.filePath, filePath),
        ];
        if (trigger) where.push(eq(fileSnapshots.trigger, trigger));
        const row = db
          .select()
          .from(fileSnapshots)
          .where(and(...where))
          .orderBy(desc(fileSnapshots.createdAt))
          .limit(1)
          .get();
        return row ?? null;
      },
      getById: (workspaceId, snapshotId) => {
        const row = db
          .select()
          .from(fileSnapshots)
          .where(
            and(
              eq(fileSnapshots.workspaceId, workspaceId),
              eq(fileSnapshots.id, snapshotId),
            ),
          )
          .get();
        return row ?? null;
      },
      delete: (workspaceId, snapshotId) => {
        // Count before delete to detect "row existed" without depending on
        // the Drizzle return type (which on bun:sqlite is `void`).
        const existing = db
          .select({ id: fileSnapshots.id })
          .from(fileSnapshots)
          .where(
            and(
              eq(fileSnapshots.workspaceId, workspaceId),
              eq(fileSnapshots.id, snapshotId),
            ),
          )
          .get();
        if (!existing) return false;
        db.delete(fileSnapshots)
          .where(
            and(
              eq(fileSnapshots.workspaceId, workspaceId),
              eq(fileSnapshots.id, snapshotId),
            ),
          )
          .run();
        return true;
      },
      count: (workspaceId, filePath) => {
        if (filePath) {
          const row = db
            .select({ n: sql<number>`COUNT(*)` })
            .from(fileSnapshots)
            .where(
              and(
                eq(fileSnapshots.workspaceId, workspaceId),
                eq(fileSnapshots.filePath, filePath),
              ),
            )
            .get();
          return row?.n ?? 0;
        }
        const row = db
          .select({ n: sql<number>`COUNT(*)` })
          .from(fileSnapshots)
          .where(eq(fileSnapshots.workspaceId, workspaceId))
          .get();
        return row?.n ?? 0;
      },
      trim: (workspaceId, filePath, keepLast) => {
        // Keep top `keepLast` rows by created_at; delete the rest.
        const keepers = db
          .select({ id: fileSnapshots.id })
          .from(fileSnapshots)
          .where(
            and(
              eq(fileSnapshots.workspaceId, workspaceId),
              eq(fileSnapshots.filePath, filePath),
            ),
          )
          .orderBy(desc(fileSnapshots.createdAt))
          .limit(keepLast)
          .all();
        const keepIds = new Set(keepers.map((k) => k.id));
        const all = db
          .select({ id: fileSnapshots.id })
          .from(fileSnapshots)
          .where(
            and(
              eq(fileSnapshots.workspaceId, workspaceId),
              eq(fileSnapshots.filePath, filePath),
            ),
          )
          .all();
        const toDelete = all.filter((r) => !keepIds.has(r.id)).map((r) => r.id);
        if (!toDelete.length) return 0;
        for (const id of toDelete) {
          db.delete(fileSnapshots)
            .where(
              and(
                eq(fileSnapshots.workspaceId, workspaceId),
                eq(fileSnapshots.id, id),
              ),
            )
            .run();
        }
        return toDelete.length;
      },
      // Phase 6.9: workspace-wide list of agent-triggered snapshots
      // filtered by status. Used by `GET /agent-snapshots?status=...`
      // to power the Review tab's History view.
      listByStatus: (workspaceId, opts) => {
        const baseWhere = and(
          eq(fileSnapshots.workspaceId, workspaceId),
          eq(fileSnapshots.trigger, opts.trigger),
          eq(fileSnapshots.status, opts.status),
        );
        const where = opts.before !== undefined
          ? and(baseWhere, lt(fileSnapshots.createdAt, opts.before))
          : baseWhere;
        return db
          .select()
          .from(fileSnapshots)
          .where(where)
          .orderBy(desc(fileSnapshots.createdAt))
          .limit(opts.limit)
          .all();
      },
      // L3 fix: "all agent snapshots" mode — used by `GET /agent-snapshots`
      // without a status filter. Includes legacy rows (status IS NULL).
      // Routed through the shared db connection so we don't pay the
      // per-call open/close cost of a raw read-only handle.
      listAllAgent: (workspaceId, opts) => {
        const baseWhere = and(
          eq(fileSnapshots.workspaceId, workspaceId),
          eq(fileSnapshots.trigger, "agent"),
        );
        const where = opts.before !== undefined
          ? and(baseWhere, lt(fileSnapshots.createdAt, opts.before))
          : baseWhere;
        return db
          .select()
          .from(fileSnapshots)
          .where(where)
          .orderBy(desc(fileSnapshots.createdAt))
          .limit(opts.limit)
          .all();
      },
      // Phase 6.9 hotfix: latest non-agent snapshot for a file.
      // Returns whichever of (latest manual, latest auto) is newer;
      // null if neither exists.
      findLatestNonAgent: (workspaceId, filePath) => {
        const baseWhere = and(
          eq(fileSnapshots.workspaceId, workspaceId),
          eq(fileSnapshots.filePath, filePath),
        );
        const latestManual = db
          .select()
          .from(fileSnapshots)
          .where(and(baseWhere, eq(fileSnapshots.trigger, "manual")))
          .orderBy(desc(fileSnapshots.createdAt))
          .limit(1)
          .get();
        const latestAuto = db
          .select()
          .from(fileSnapshots)
          .where(and(baseWhere, eq(fileSnapshots.trigger, "auto")))
          .orderBy(desc(fileSnapshots.createdAt))
          .limit(1)
          .get();
        if (!latestManual) return latestAuto ?? null;
        if (!latestAuto) return latestManual;
        return latestManual.createdAt >= latestAuto.createdAt ? latestManual : latestAuto;
      },
      setStatus: (workspaceId, snapshotId, status) => {
        const result = db
          .update(fileSnapshots)
          .set({ status })
          .where(
            and(
              eq(fileSnapshots.workspaceId, workspaceId),
              eq(fileSnapshots.id, snapshotId),
            ),
          )
          .returning()
          .get();
        return result ?? null;
      },
      setParent: (workspaceId, snapshotId, parentSnapshotId) => {
        db
          .update(fileSnapshots)
          .set({ parentSnapshotId })
          .where(
            and(
              eq(fileSnapshots.workspaceId, workspaceId),
              eq(fileSnapshots.id, snapshotId),
            ),
          )
          .run();
      },
    };
  }

  // Fallback: node:sqlite (no Drizzle prepared-statement wrapper; use raw SQL)
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS file_snapshots (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      revision TEXT
    )
  `);
  // Phase 6.9: approval workflow columns. Added via ALTER TABLE so
  // legacy databases created before the migration still upgrade
  // cleanly.
  const columnCheck = sqlite
    .prepare("SELECT name FROM pragma_table_info('file_snapshots')")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columnCheck.map((row) => row.name));
  if (!columnNames.has("status")) {
    sqlite.exec("ALTER TABLE file_snapshots ADD COLUMN status TEXT");
  }
  if (!columnNames.has("parent_snapshot_id")) {
    sqlite.exec("ALTER TABLE file_snapshots ADD COLUMN parent_snapshot_id TEXT");
  }
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_workspace_file
      ON file_snapshots(workspace_id, file_path, created_at)
  `);
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_dedup
      ON file_snapshots(workspace_id, file_path, content_hash)
  `);
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_status
      ON file_snapshots(workspace_id, status, created_at)
  `);
  // L3 fix: WAL mode for concurrent read+write. See bun:sqlite path
  // above for the rationale.
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  // SELECT column list shared by every statement so the new status /
  // parent_snapshot_id columns are picked up uniformly.
  const selectColumns =
    "id, workspace_id AS workspaceId, file_path AS filePath, content_hash AS contentHash, content, size, created_at AS createdAt, trigger, revision, status, parent_snapshot_id AS parentSnapshotId";
  const insert = sqlite.prepare(
    "INSERT INTO file_snapshots (id, workspace_id, file_path, content_hash, content, size, created_at, trigger, revision, status, parent_snapshot_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const findByDedup = sqlite.prepare(
    `SELECT ${selectColumns} FROM file_snapshots WHERE workspace_id = ? AND file_path = ? AND content_hash = ?`,
  );
  const listStmt = sqlite.prepare(
    `SELECT ${selectColumns} FROM file_snapshots WHERE workspace_id = ? AND file_path = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
  );
  const listNoCursor = sqlite.prepare(
    `SELECT ${selectColumns} FROM file_snapshots WHERE workspace_id = ? AND file_path = ? ORDER BY created_at DESC LIMIT ?`,
  );
  // Latest-snapshot lookup with an optional trigger filter. The SQL
  // is built per call so we can skip the WHERE clause when no filter
  // is provided (covers the History tab "Save snapshot" badge) and
  // append the filter when the agent-review banner needs the
  // "latest agent edit" specifically.
  const buildLatestSql = (trigger: string | undefined) => {
    const base = `SELECT ${selectColumns} FROM file_snapshots WHERE workspace_id = ? AND file_path = ?`;
    return base + (trigger ? " AND trigger = ? ORDER BY created_at DESC LIMIT 1" : " ORDER BY created_at DESC LIMIT 1");
  };
  const latestNoFilter = sqlite.prepare(buildLatestSql(undefined));
  const latestAgent = sqlite.prepare(buildLatestSql("agent"));
  const latestAuto = sqlite.prepare(buildLatestSql("auto"));
  const latestManual = sqlite.prepare(buildLatestSql("manual"));
  const byIdStmt = sqlite.prepare(
    `SELECT ${selectColumns} FROM file_snapshots WHERE workspace_id = ? AND id = ?`,
  );
  // L3 fix: prepared statement for "all agent snapshots" mode.
  // Built per call so we can include the `before` cursor predicate
  // without a second statement.
  const buildListAllAgentSql = (before: number | undefined) => {
    const base = `FROM file_snapshots WHERE workspace_id = ? AND trigger = 'agent'`;
    return before !== undefined
      ? `SELECT ${selectColumns} ${base} AND created_at < ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT ${selectColumns} ${base} ORDER BY created_at DESC LIMIT ?`;
  };
  const listAllAgentNoCursor = sqlite.prepare(buildListAllAgentSql(undefined));
  const listAllAgentWithCursor = sqlite.prepare(buildListAllAgentSql(0));
  const deleteStmt = sqlite.prepare(
    "DELETE FROM file_snapshots WHERE workspace_id = ? AND id = ?",
  );
  const countAllStmt = sqlite.prepare(
    "SELECT COUNT(*) AS n FROM file_snapshots WHERE workspace_id = ?",
  );
  const countByFileStmt = sqlite.prepare(
    "SELECT COUNT(*) AS n FROM file_snapshots WHERE workspace_id = ? AND file_path = ?",
  );
  const idsAllStmt = sqlite.prepare(
    "SELECT id FROM file_snapshots WHERE workspace_id = ? AND file_path = ? ORDER BY created_at DESC",
  );
  // Phase 6.9: status update statement for approve/reject. Uses COALESCE
  // so callers can pass a single `status` (or both `status` and
  // `parentSnapshotId`) without juggling the column list each time.
  const updateStatusStmt = sqlite.prepare(
    "UPDATE file_snapshots SET status = ?, parent_snapshot_id = COALESCE(?, parent_snapshot_id) WHERE workspace_id = ? AND id = ?",
  );
  const updateParentStmt = sqlite.prepare(
    "UPDATE file_snapshots SET parent_snapshot_id = ? WHERE workspace_id = ? AND id = ?",
  );

  return {
    save: (input) => {
      try {
        insert.run(
          input.id,
          input.workspaceId,
          input.filePath,
          input.contentHash,
          input.content,
          input.size,
          input.createdAt,
          input.trigger,
          input.revision,
          input.status,
          input.parentSnapshotId,
        );
        return { row: input, deduped: false };
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
          const existing = findByDedup.get(
            input.workspaceId,
            input.filePath,
            input.contentHash,
          ) as SnapshotRow | undefined;
          if (existing) return { row: existing, deduped: true };
        }
        throw err;
      }
    },
    list: (workspaceId, filePath, opts) => {
      const rows = opts.before !== undefined
        ? (listStmt.all(workspaceId, filePath, opts.before, opts.limit) as SnapshotRow[])
        : (listNoCursor.all(workspaceId, filePath, opts.limit) as SnapshotRow[]);
      return rows;
    },
    findLatest: (workspaceId, filePath, trigger) => {
      let row: SnapshotRow | undefined;
      if (trigger === "agent") {
        row = latestAgent.get(workspaceId, filePath, "agent") as SnapshotRow | undefined;
      } else if (trigger === "auto") {
        row = latestAuto.get(workspaceId, filePath, "auto") as SnapshotRow | undefined;
      } else if (trigger === "manual") {
        row = latestManual.get(workspaceId, filePath, "manual") as SnapshotRow | undefined;
      } else {
        row = latestNoFilter.get(workspaceId, filePath) as SnapshotRow | undefined;
      }
      return row ?? null;
    },
    getById: (workspaceId, snapshotId) => {
      const row = byIdStmt.get(workspaceId, snapshotId) as SnapshotRow | undefined;
      return row ?? null;
    },
    delete: (workspaceId, snapshotId) => {
      const result = deleteStmt.run(workspaceId, snapshotId);
      return result.changes > 0;
    },
    count: (workspaceId, filePath) => {
      const row = filePath
        ? (countByFileStmt.get(workspaceId, filePath) as { n: number } | undefined)
        : (countAllStmt.get(workspaceId) as { n: number } | undefined);
      return row?.n ?? 0;
    },
    trim: (workspaceId, filePath, keepLast) => {
      const all = idsAllStmt.all(workspaceId, filePath) as Array<{ id: string }>;
      const toDelete = all.slice(keepLast);
      for (const { id } of toDelete) {
        deleteStmt.run(workspaceId, id);
      }
      return toDelete.length;
    },
    // Phase 6.9: list agent snapshots by status. The SQL string is built
    // per call so we can include/exclude the `before` cursor predicate
    // without a second prepared statement. (Rev 3 fix: avoid the
    // `SELECT ${base}` trap that produced `SELECT SELECT ...` — kept
    // the same shape as the all-mode list above.)
    listByStatus: (workspaceId, opts) => {
      const fromClause =
        `FROM file_snapshots WHERE workspace_id = ? AND trigger = ? AND status = ?`;
      const sql_ = opts.before !== undefined
        ? `SELECT ${selectColumns} ${fromClause} AND created_at < ? ORDER BY created_at DESC LIMIT ?`
        : `SELECT ${selectColumns} ${fromClause} ORDER BY created_at DESC LIMIT ?`;
      const params: Array<string | number> = [workspaceId, opts.trigger, opts.status];
      if (opts.before !== undefined) params.push(opts.before);
      params.push(opts.limit);
      return sqlite.prepare(sql_).all(...params) as SnapshotRow[];
    },
    // L3 fix: all-agent mode for `GET /agent-snapshots` (no status
    // filter). Includes legacy rows where status IS NULL.
    listAllAgent: (workspaceId, opts) => {
      if (opts.before !== undefined) {
        return listAllAgentWithCursor.all(workspaceId, opts.before, opts.limit) as SnapshotRow[];
      }
      return listAllAgentNoCursor.all(workspaceId, opts.limit) as SnapshotRow[];
    },
    // Phase 6.9 hotfix: latest non-agent snapshot for a file.
    findLatestNonAgent: (workspaceId, filePath) => {
      const manual = latestManual.get(workspaceId, filePath, "manual") as SnapshotRow | undefined;
      const auto = latestAuto.get(workspaceId, filePath, "auto") as SnapshotRow | undefined;
      if (!manual) return auto ?? null;
      if (!auto) return manual;
      return manual.createdAt >= auto.createdAt ? manual : auto;
    },
    setStatus: (workspaceId, snapshotId, status) => {
      const result = updateStatusStmt.run(status, null, workspaceId, snapshotId);
      if (result.changes === 0) return null;
      return byIdStmt.get(workspaceId, snapshotId) as SnapshotRow | null;
    },
    setParent: (workspaceId, snapshotId, parentSnapshotId) => {
      updateParentStmt.run(parentSnapshotId, workspaceId, snapshotId);
    },
  };
}

const dbByPath = new Map<string, Promise<SnapshotDb>>();

async function snapshotDb(config: ServerConfig): Promise<SnapshotDb> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  const next = openSnapshotDb(path);
  dbByPath.set(path, next);
  return next;
}

export type SaveSnapshotInput = {
  workspaceId: string;
  filePath: string;
  content: string;
  trigger?: FileSnapshotTrigger;
  revision?: string | null;
  /** Override `createdAt` (default `Date.now()`). Used in tests. */
  createdAt?: number;
  /** Override id (default shortId). Used in tests. */
  id?: string;
  /**
   * Phase 6.9: approval workflow fields. Only persisted when the
   * trigger is `agent`; ignored otherwise. The slice-6.9 routes pass
   * `parentSnapshotId` so reject can roll back to the pre-AI content.
   */
  status?: FileSnapshotStatus;
  parentSnapshotId?: string | null;
};

export type SaveSnapshotResult = {
  snapshot: FileSnapshot;
  deduped: boolean;
  trimmed: number;
};

export class SnapshotStore {
  constructor(private readonly config: ServerConfig) {}

  async save(input: SaveSnapshotInput): Promise<SaveSnapshotResult> {
    if (typeof input.content !== "string") {
      throw new TypeError("SnapshotStore.save: content must be a string");
    }
    const content = input.content;
    if (Buffer.byteLength(content, "utf8") > MAX_SNAPSHOT_BYTES) {
      throw new RangeError(
        `SnapshotStore.save: content exceeds MAX_SNAPSHOT_BYTES (${MAX_SNAPSHOT_BYTES})`,
      );
    }
    const trigger: FileSnapshotTrigger = input.trigger ?? "auto";
  if (!isValidTrigger(trigger)) {
    throw new TypeError(`SnapshotStore.save: invalid trigger '${input.trigger}'`);
  }
    // Phase 6.9: status is only meaningful for agent-triggered rows.
    // Default to "pending" for a fresh agent snapshot so the Review tab
    // can pick it up without a separate status write.
    const status: FileSnapshotStatus | null =
      trigger === "agent"
        ? input.status ?? "pending"
        : null;
    if (status !== null && !isValidStatus(status)) {
      throw new TypeError(`SnapshotStore.save: invalid status '${input.status}'`);
    }
    const db = await snapshotDb(this.config);
    const row: SnapshotRow = {
      id: input.id ?? shortId(),
      workspaceId: input.workspaceId,
      filePath: input.filePath,
      contentHash: normalizeContentHash(content),
      content,
      size: Buffer.byteLength(content, "utf8"),
      createdAt: input.createdAt ?? Date.now(),
      trigger,
      revision: input.revision ?? null,
      status,
      parentSnapshotId: input.parentSnapshotId ?? null,
    };
    const { row: stored, deduped } = db.save(row);
    if (deduped) {
      return { snapshot: rowToSnapshot(stored), deduped: true, trimmed: 0 };
    }
    const trimmed = db.trim(input.workspaceId, input.filePath, SNAPSHOT_KEEP_LAST);
    return { snapshot: rowToSnapshot(stored), deduped: false, trimmed };
  }

  async list(
    workspaceId: string,
    filePath: string,
    opts: { limit?: number; before?: number } = {},
  ): Promise<FileSnapshot[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const db = await snapshotDb(this.config);
    const rows = db.list(workspaceId, filePath, { limit, before: opts.before });
    return rows.map(rowToSnapshot);
  }

  /**
   * Find the most recent snapshot for a (workspace, file) pair, with
   * an optional trigger filter. Used by the History tab's "Save
   * snapshot" status badge (no filter) and by the Phase 6.8 agent
   * review banner (`{ trigger: "agent" }`).
   */
  async findLatest(
    workspaceId: string,
    filePath: string,
    opts?: { trigger?: FileSnapshotTrigger },
  ): Promise<FileSnapshot | null> {
    const db = await snapshotDb(this.config);
    const row = db.findLatest(workspaceId, filePath, opts?.trigger);
    return row ? rowToSnapshot(row) : null;
  }

  async getById(workspaceId: string, snapshotId: string): Promise<FileSnapshot | null> {
    const db = await snapshotDb(this.config);
    const row = db.getById(workspaceId, snapshotId);
    if (!row) return null;
    // Defensive: callers trust workspaceId as the auth scope.
    if (row.workspaceId !== workspaceId) return null;
    return rowToSnapshot(row);
  }

  async delete(workspaceId: string, snapshotId: string): Promise<boolean> {
    const db = await snapshotDb(this.config);
    return db.delete(workspaceId, snapshotId);
  }

  async count(workspaceId: string, filePath?: string): Promise<number> {
    const db = await snapshotDb(this.config);
    return db.count(workspaceId, filePath);
  }

  async trim(workspaceId: string, filePath: string, keepLast = SNAPSHOT_KEEP_LAST): Promise<number> {
    const db = await snapshotDb(this.config);
    return db.trim(workspaceId, filePath, keepLast);
  }

  // -----------------------------------------------------------------
  // Phase 6.9: approval workflow
  // -----------------------------------------------------------------

  /**
   * Mark an agent snapshot as approved. Pure metadata write — the file
   * on disk is left as-is so git sees the post-AI content naturally.
   * Returns the updated snapshot, or `null` if the row didn't exist
   * (404 surface for the route handler).
   */
  async approve(workspaceId: string, snapshotId: string): Promise<FileSnapshot | null> {
    const db = await snapshotDb(this.config);
    const row = db.setStatus(workspaceId, snapshotId, "approved");
    return row ? rowToSnapshot(row) : null;
  }

  /**
   * Mark an agent snapshot as rejected. Caller is responsible for
   * having already restored the file content (the route handler calls
   * the existing restore logic first); this method only flips the
   * status flag so the row stops showing up in the pending list.
   */
  async reject(workspaceId: string, snapshotId: string): Promise<FileSnapshot | null> {
    const db = await snapshotDb(this.config);
    const row = db.setStatus(workspaceId, snapshotId, "rejected");
    return row ? rowToSnapshot(row) : null;
  }

  /**
   * Phase 6.9 hotfix: latest non-agent snapshot for a file, or null.
   * Used by the pending-approvals route to backfill the
   * `parentSnapshotId` field on legacy agent rows so the Review
   * tab's diff has something to render.
   */
  async findLatestNonAgent(
    workspaceId: string,
    filePath: string,
  ): Promise<FileSnapshot | null> {
    const db = await snapshotDb(this.config);
    const row = db.findLatestNonAgent(workspaceId, filePath);
    return row ? rowToSnapshot(row) : null;
  }

  /**
   * List every agent-triggered snapshot in the workspace, optionally
   * filtered by approval status. Cursor pagination by `createdAt` so
   * the Review tab can page through long histories without offset
   * drift. Returns rows newest-first.
   */
  async listAgentSnapshots(
    workspaceId: string,
    opts: { status?: FileSnapshotStatus; limit?: number; before?: number } = {},
  ): Promise<FileSnapshot[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const db = await snapshotDb(this.config);
    // L3 fix: both branches now go through the shared `snapshotDb`
    // connection. The previous implementation opened a fresh
    // read-only handle per call (and a second one for the Drizzle
    // path on top of that) — wasteful, and racy without WAL. With
    // WAL enabled in `openSnapshotDb`, concurrent reads on the same
    // connection are safe and cheap.
    if (opts.status === undefined) {
      const rows = db.listAllAgent(workspaceId, {
        limit,
        before: opts.before,
      });
      return rows.map(rowToSnapshot);
    }
    const rows = db.listByStatus(workspaceId, {
      trigger: "agent",
      status: opts.status,
      limit,
      before: opts.before,
    });
    return rows.map(rowToSnapshot);
  }

  /**
   * Stamp `parentSnapshotId` onto a snapshot row. Used by the agent
   * edit path: when the AI writes a new version, we mark the prior
   * snapshot id so a later reject can roll back to the pre-AI content.
   */
  async setParentSnapshotId(
    workspaceId: string,
    snapshotId: string,
    parentSnapshotId: string | null,
  ): Promise<void> {
    const db = await snapshotDb(this.config);
    db.setParent(workspaceId, snapshotId, parentSnapshotId);
  }
}

/**
 * Pure helper exported for unit tests. Mirrors what `save()` writes into the
 * `content_hash` column. Stable across processes (sha256 of UTF-8 bytes).
 */
export function computeContentHash(content: string): string {
  return normalizeContentHash(content);
}

export { isValidTrigger };
