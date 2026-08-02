/**
 * Read-only SQLite queries against the live opencode.db.
 *
 * We open in read-only mode (Bun:sqlite `readonly: true` is honored; for
 * node `better-sqlite3` you'd use `readonly: true` as well). The archive
 * script's prune pass opens a SECOND connection read-write — see
 * `lib/pruner.ts`.
 *
 * Schema observations (opencode 1.17.x):
 * - session: rows include workspace_id, parent_id, agent, model (json string),
 *   tokens_input/output/reasoning/cache_read/cache_write, cost, time_*
 * - message: per-row = one turn (user/assistant/tool). data is JSON.
 * - part: per-row = one part of a message (text/tool/reasoning/patch/...),
 *   linked to message via message_id. data is JSON.
 * - session_input: optional per-prompt snapshot. May be empty in current
 *   opencode builds but we read it for forward-compat.
 * - session_message: appears unused (no rows in observed DB) but exists
 *   in schema. Skipped.
 * - session_context_epoch: appears unused. Skipped.
 */

import { Database } from "bun:sqlite";

export type SessionRow = {
  id: string;
  project_id: string;
  workspace_id: string | null;
  parent_id: string | null;
  slug: string;
  directory: string;
  path: string | null;
  title: string;
  version: string;
  share_url: string | null;
  summary_additions: number | null;
  summary_deletions: number | null;
  summary_files: number | null;
  summary_diffs: string | null;
  metadata: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  revert: string | null;
  permission: string | null;
  agent: string | null;
  model: string | null;
  time_created: number;
  time_updated: number;
  time_compacting: number | null;
  time_archived: number | null;
};

export type MessageRow = {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
};

export type PartRow = {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
};

export type EventRow = {
  id: string;
  aggregate_id: string;
  seq: number;
  type: string;
  data: string;
};

export type SessionInputRow = {
  id: string;
  session_id: string;
  admitted_seq: number;
  promoted_seq: number | null;
  time_created: number;
  prompt: string;
  delivery: string;
};

export type ArchiveCandidate = SessionRow;

export class OpencodeDb {
  private constructor(public readonly db: Database) {}

  /**
   * Open in read-only mode. The Bun sqlite driver rejects writes at the
   * protocol level; this is enough to avoid accidental writes even if
   * the script is run as the same user as the live opencode server.
   */
  static openReadOnly(path: string): OpencodeDb {
    const db = new Database(path, { readonly: true });
    db.exec("PRAGMA query_only = 1");
    return new OpencodeDb(db);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Sessions that haven't been touched in `idleDays` days AND have no
   * recent message activity. Excludes sessions already archived in opencode
   * (time_archived IS NOT NULL) so we never re-archive.
   */
  listCandidates(idleDays: number, now: number = Date.now()): ArchiveCandidate[] {
    const idleMs = idleDays * 86_400_000;
    const cutoff = now - idleMs;
    return this.db
      .query<
        SessionRow,
        [number, number]
      >(
        `SELECT
           id, project_id, workspace_id, parent_id, slug, directory, path,
           title, version, share_url, summary_additions, summary_deletions,
           summary_files, summary_diffs, metadata, cost,
           tokens_input, tokens_output, tokens_reasoning,
           tokens_cache_read, tokens_cache_write,
           revert, permission, agent, model,
           time_created, time_updated, time_compacting, time_archived
         FROM session
         WHERE time_updated < ?1
           AND time_archived IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM message m
             WHERE m.session_id = session.id AND m.time_created > ?2
           )
         ORDER BY time_updated ASC`,
      )
      .all(cutoff, cutoff);
  }

  /**
   * Sessions that were previously soft-archived (time_archived set) more
   * than `hardDeleteDays` ago AND have a corresponding archive folder on
   * disk. Only these are eligible for hard delete.
   */
  listHardDeleteCandidates(hardDeleteDays: number, now: number = Date.now()): SessionRow[] {
    // `hardDeleteDays <= 0` means "any session that was archived in the
    // past is eligible" (used for the first-time catch-up and for tests).
    if (hardDeleteDays <= 0) {
      return this.db
        .query<SessionRow, []>(
          `SELECT
             id, project_id, workspace_id, parent_id, slug, directory, path,
             title, version, share_url, summary_additions, summary_deletions,
             summary_files, summary_diffs, metadata, cost,
             tokens_input, tokens_output, tokens_reasoning,
             tokens_cache_read, tokens_cache_write,
             revert, permission, agent, model,
             time_created, time_updated, time_compacting, time_archived
           FROM session
           WHERE time_archived IS NOT NULL
             AND time_archived > 0
           ORDER BY time_archived ASC`,
        )
        .all();
    }
    const cutoff = now - hardDeleteDays * 86_400_000;
    return this.db
      .query<
        SessionRow,
        [number]
      >(
        `SELECT
           id, project_id, workspace_id, parent_id, slug, directory, path,
           title, version, share_url, summary_additions, summary_deletions,
           summary_files, summary_diffs, metadata, cost,
           tokens_input, tokens_output, tokens_reasoning,
           tokens_cache_read, tokens_cache_write,
           revert, permission, agent, model,
           time_created, time_updated, time_compacting, time_archived
         FROM session
         WHERE time_archived IS NOT NULL
           AND time_archived > 0
           AND time_archived < ?1
         ORDER BY time_archived ASC`,
      )
      .all(cutoff);
  }

  getSession(id: string): SessionRow | null {
    const row = this.db
      .query<
        SessionRow,
        [string]
      >(
        `SELECT
           id, project_id, workspace_id, parent_id, slug, directory, path,
           title, version, share_url, summary_additions, summary_deletions,
           summary_files, summary_diffs, metadata, cost,
           tokens_input, tokens_output, tokens_reasoning,
           tokens_cache_read, tokens_cache_write,
           revert, permission, agent, model,
           time_created, time_updated, time_compacting, time_archived
         FROM session WHERE id = ?1`,
      )
      .get(id);
    return row ?? null;
  }

  getMessages(sessionId: string): MessageRow[] {
    return this.db
      .query<MessageRow, [string]>(
        `SELECT id, session_id, time_created, time_updated, data
         FROM message WHERE session_id = ?1 ORDER BY time_created ASC`,
      )
      .all(sessionId);
  }

  getParts(sessionId: string): PartRow[] {
    return this.db
      .query<PartRow, [string]>(
        `SELECT id, message_id, session_id, time_created, time_updated, data
         FROM part WHERE session_id = ?1 ORDER BY time_created ASC`,
      )
      .all(sessionId);
  }

  getSessionInput(sessionId: string): SessionInputRow[] {
    return this.db
      .query<SessionInputRow, [string]>(
        `SELECT id, session_id, admitted_seq, promoted_seq, time_created, prompt, delivery
         FROM session_input WHERE session_id = ?1 ORDER BY admitted_seq ASC`,
      )
      .all(sessionId);
  }

  getEvents(sessionId: string): EventRow[] {
    return this.db
      .query<EventRow, [string]>(
        `SELECT id, aggregate_id, seq, type, data
         FROM event WHERE aggregate_id = ?1 ORDER BY seq ASC`,
      )
      .all(sessionId);
  }
}

/**
 * Total bytes used by all rows in the opencode.db. Useful for "before/after
 * archive" reports — the prune pass should reclaim at least the size of the
 * exported messages + parts.
 */
export function liveDbByteSize(path: string): number {
  try {
    return Bun.file(path).size;
  } catch {
    return 0;
  }
}
