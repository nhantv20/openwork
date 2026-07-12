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
import type { FileSnapshot, FileSnapshotTrigger, ServerConfig } from "./types.js";
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
};

type SnapshotDb = {
  save: (input: SnapshotRow) => { row: SnapshotRow; deduped: boolean };
  list: (
    workspaceId: string,
    filePath: string,
    opts: { limit: number; before?: number },
  ) => SnapshotRow[];
  findLatest: (workspaceId: string, filePath: string) => SnapshotRow | null;
  getById: (workspaceId: string, snapshotId: string) => SnapshotRow | null;
  delete: (workspaceId: string, snapshotId: string) => boolean;
  count: (workspaceId: string, filePath?: string) => number;
  trim: (workspaceId: string, filePath: string, keepLast: number) => number;
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
  };
}

function isValidTrigger(value: string): value is FileSnapshotTrigger {
  return value === "auto" || value === "manual" || value === "agent";
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
    sqlite.run(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_workspace_file
        ON file_snapshots(workspace_id, file_path, created_at)
    `);
    sqlite.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_dedup
        ON file_snapshots(workspace_id, file_path, content_hash)
    `);
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
      findLatest: (workspaceId, filePath) => {
        const row = db
          .select()
          .from(fileSnapshots)
          .where(
            and(
              eq(fileSnapshots.workspaceId, workspaceId),
              eq(fileSnapshots.filePath, filePath),
            ),
          )
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
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_workspace_file
      ON file_snapshots(workspace_id, file_path, created_at)
  `);
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_dedup
      ON file_snapshots(workspace_id, file_path, content_hash)
  `);
  const insert = sqlite.prepare(
    "INSERT INTO file_snapshots (id, workspace_id, file_path, content_hash, content, size, created_at, trigger, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const findByDedup = sqlite.prepare(
    "SELECT id, workspace_id AS workspaceId, file_path AS filePath, content_hash AS contentHash, content, size, created_at AS createdAt, trigger, revision FROM file_snapshots WHERE workspace_id = ? AND file_path = ? AND content_hash = ?",
  );
  const listStmt = sqlite.prepare(
    "SELECT id, workspace_id AS workspaceId, file_path AS filePath, content_hash AS contentHash, content, size, created_at AS createdAt, trigger, revision FROM file_snapshots WHERE workspace_id = ? AND file_path = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
  );
  const listNoCursor = sqlite.prepare(
    "SELECT id, workspace_id AS workspaceId, file_path AS filePath, content_hash AS contentHash, content, size, created_at AS createdAt, trigger, revision FROM file_snapshots WHERE workspace_id = ? AND file_path = ? ORDER BY created_at DESC LIMIT ?",
  );
  const latestStmt = sqlite.prepare(
    "SELECT id, workspace_id AS workspaceId, file_path AS filePath, content_hash AS contentHash, content, size, created_at AS createdAt, trigger, revision FROM file_snapshots WHERE workspace_id = ? AND file_path = ? ORDER BY created_at DESC LIMIT 1",
  );
  const byIdStmt = sqlite.prepare(
    "SELECT id, workspace_id AS workspaceId, file_path AS filePath, content_hash AS contentHash, content, size, created_at AS createdAt, trigger, revision FROM file_snapshots WHERE workspace_id = ? AND id = ?",
  );
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
    findLatest: (workspaceId, filePath) => {
      const row = latestStmt.get(workspaceId, filePath) as SnapshotRow | undefined;
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

  async findLatest(workspaceId: string, filePath: string): Promise<FileSnapshot | null> {
    const db = await snapshotDb(this.config);
    const row = db.findLatest(workspaceId, filePath);
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
}

/**
 * Pure helper exported for unit tests. Mirrors what `save()` writes into the
 * `content_hash` column. Stable across processes (sha256 of UTF-8 bytes).
 */
export function computeContentHash(content: string): string {
  return normalizeContentHash(content);
}

export { isValidTrigger };
