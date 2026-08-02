/**
 * Soft-archive and hard-delete operations against the live opencode.db.
 *
 * Two distinct passes:
  *  - `markArchived(sessionId, expectedTimeUpdated, now)` — sets time_archived = now
  *    only if the session has not changed. We do this
 *    AFTER the archive folder is on disk, so the live DB always reflects
 *    "this session has a backup".
 *  - `hardDelete(sessionId)` — DELETE FROM session. ON DELETE CASCADE
 *    wipes message, part, session_input rows for that session. Caller
 *    MUST verify an archive folder exists first.
 *
 * VACUUM is run once at the end of a hard-delete batch to reclaim disk.
 * The live opencode server uses WAL mode, so VACUUM requires a brief
 * exclusive lock — it's expected to take a few seconds for a 250MB DB.
 */

import { Database } from "bun:sqlite";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export class OpencodeDbWriter {
  private constructor(public readonly db: Database) {}

  /**
   * Open a separate read-write connection to the same DB. We do NOT use
   * the connection from opencode-db.ts (which is read-only).
   */
  static open(dbPath: string): OpencodeDbWriter {
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
    return new OpencodeDbWriter(db);
  }

  close(): void {
    this.db.close();
  }

  markArchived(sessionId: string, expectedTimeUpdated: number, now: number): boolean {
    const result = this.db
      .prepare("UPDATE session SET time_archived = ?1 WHERE id = ?2 AND time_updated = ?3 AND time_archived IS NULL")
      .run(now, sessionId, expectedTimeUpdated);
    return result.changes === 1;
  }

  /**
   * Hard delete a session row. ON DELETE CASCADE removes its messages
   * and parts. Caller must verify an archive folder exists first; this
   * function does NOT re-check.
   */
  hardDelete(sessionId: string): {
    messagesDeleted: number;
    partsDeleted: number;
    sessionInputDeleted: number;
    eventsDeleted: number;
    eventSequenceDeleted: number;
  } {
    // Capture pre-delete counts so we can return the cleanup size.
    const counts = {
      messagesDeleted: (this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM message WHERE session_id = ?1")
        .get(sessionId)?.n) ?? 0,
      partsDeleted: (this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM part WHERE session_id = ?1")
        .get(sessionId)?.n) ?? 0,
      sessionInputDeleted: (this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM session_input WHERE session_id = ?1")
        .get(sessionId)?.n) ?? 0,
      eventsDeleted: (this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM event WHERE aggregate_id = ?1")
        .get(sessionId)?.n) ?? 0,
      eventSequenceDeleted: (this.db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM event_sequence WHERE aggregate_id = ?1")
        .get(sessionId)?.n) ?? 0,
    };

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM event WHERE aggregate_id = ?1").run(sessionId);
      this.db.prepare("DELETE FROM event_sequence WHERE aggregate_id = ?1").run(sessionId);
      this.db.prepare("DELETE FROM session WHERE id = ?1").run(sessionId);
    })();

    return counts;
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }
}

/**
 * Compute the total size of an archive folder, in bytes (recursive).
 * Used for the "freed X MB" report. Bun.file doesn't recurse, so we
 * walk manually.
 */
export async function directorySize(path: string): Promise<number> {
  let total = 0;
  const stack: string[] = [path];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    let entries: string[];
    try {
      entries = await readdir(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const child = join(cur, name);
      let s: Awaited<ReturnType<typeof stat>>;
      try {
        s = await stat(child);
      } catch {
        continue;
      }
      if (s.isDirectory()) stack.push(child);
      else if (s.isFile()) total += s.size;
    }
  }
  return total;
}
