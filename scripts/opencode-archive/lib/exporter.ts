/**
 * Export a single session from the live opencode.db to a per-session folder
 * under the archive root.
 *
 * Strategy:
 *  1. Stage everything under <archiveRoot>/YYYY-MM/.<sessionId>.tmp-<rand>/
 *     (same parent as the final target, so the final rename is local)
 *  2. Write session.json, messages.jsonl, parts.jsonl, session_input.jsonl
 *  3. Copy attachments referenced by parts (currently best-effort: we
 *     only know about the tool-output directory under opencode data dir)
 *  4. Write manifest.json LAST — its presence marks the folder as complete
 *  5. Atomic rename to <archiveRoot>/YYYY-MM/<sessionId>/
 *
 * If a folder already exists (e.g. previous run failed), we append a
 * numeric suffix. We never overwrite an existing completed archive.
 */

import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  archiveDirFor,
  FILES,
  type Manifest,
  SCHEMA_VERSION,
} from "./schema.js";
import {
  OpencodeDb,
  type EventRow,
  type MessageRow,
  type PartRow,
  type SessionRow,
} from "./opencode-db.js";

export type ExportResult = {
  ok: true;
  archiveDir: string;
  manifest: Manifest;
};

export type ExportError =
  | { ok: false; reason: "already-archived"; archiveDir: string }
  | { ok: false; reason: "io"; message: string; archiveDir?: string }
  | { ok: false; reason: "session-not-found"; sessionId: string };

export type ExportOutcome = ExportResult | ExportError;

/**
 * Parse a session's `model` column. opencode stores it as a JSON-encoded
 * string like `{"providerID":"fpt","modelID":"DeepSeek-V4-Flash"}`. If
 * the column is null/empty or malformed, return null.
 */
function parseModelColumn(modelColumn: string | null): { provider_id: string; model_id: string } | null {
  if (!modelColumn) return null;
  try {
    const parsed = JSON.parse(modelColumn) as { providerID?: unknown; modelID?: unknown };
    if (typeof parsed.providerID === "string" && typeof parsed.modelID === "string") {
      return { provider_id: parsed.providerID, model_id: parsed.modelID };
    }
    return null;
  } catch {
    return null;
  }
}

function sumStringLengths<T>(rows: ReadonlyArray<T>, key: keyof T): number {
  let total = 0;
  for (const row of rows) {
    const v = row[key];
    if (typeof v === "string") total += v.length;
  }
  return total;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureUniqueTarget(target: string): Promise<string> {
  if (!(await pathExists(target))) return target;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${target}-dup${i}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`too many duplicates for ${target}`);
}

async function stageDir(parentDir: string, sessionId: string): Promise<string> {
  await mkdir(parentDir, { recursive: true });
  const stage = join(parentDir, `.${sessionId}.tmp-${randomUUID().slice(0, 8)}`);
  await mkdir(stage, { recursive: true });
  return stage;
}

function writeJsonl<T>(rows: ReadonlyArray<T>, filePath: string): Promise<number> {
  return Bun.write(filePath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""))
    .then((n) => n);
}

/**
 * Best-effort attachment copy. The opencode `tool-output/` directory holds
 * named files like `tool_<id>`. We extract IDs from parts.data and try to
 * copy each one. Missing files are logged but don't fail the export.
 */
async function copyAttachments(
  stageDir: string,
  parts: ReadonlyArray<PartRow>,
  opencodeDataDir: string,
): Promise<{ copied: number; total: number }> {
  const toolOutputDir = join(opencodeDataDir, "tool-output");
  let copied = 0;
  let total = 0;
  const seen = new Set<string>();

  await mkdir(join(stageDir, FILES.attachmentsDir), { recursive: true });

  for (const part of parts) {
    const toolIds = extractToolIds(part.data);
    for (const id of toolIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      total++;
      const src = join(toolOutputDir, `tool_${id}`);
      const dst = join(stageDir, FILES.attachmentsDir, `tool_${id}`);
      try {
        await copyFile(src, dst);
        copied++;
      } catch {
        // best-effort; skip missing
      }
    }
  }
  return { copied, total };
}

/**
 * Extract tool-call or tool-result IDs from a part's data JSON.
 * Best-effort: any property that ends with `_id` or is named `id` and
 * looks like an opencode tool output id.
 */
function extractToolIds(data: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === "object") {
      for (const [key, value] of Object.entries(v)) {
        if (typeof value === "string" && (key === "id" || key.endsWith("_id") || key === "callID" || key === "call_id")) {
          if (/^[A-Za-z0-9_-]{8,40}$/.test(value)) out.push(value);
        }
        if (value && typeof value === "object") walk(value);
      }
    }
  };
  walk(parsed);
  return out;
}

export async function exportSession(
  db: OpencodeDb,
  session: SessionRow,
  archiveRoot: string,
  opencodeDbPath: string,
  opencodeDataDir: string,
  now: number = Date.now(),
): Promise<ExportOutcome> {
  const target = await ensureUniqueTarget(archiveDirFor(archiveRoot, session.time_created, session.id));
  if (target !== archiveDirFor(archiveRoot, session.time_created, session.id)) {
    return { ok: false, reason: "already-archived", archiveDir: target };
  }

  // Stage under the same parent dir as target (so rename is local/atomic).
  const targetParent = dirname(target);
  const stage = await stageDir(targetParent, session.id);

  try {
    const messages: MessageRow[] = db.getMessages(session.id);
    const parts: PartRow[] = db.getParts(session.id);
    const sessionInput = db.getSessionInput(session.id);
    const events: EventRow[] = db.getEvents(session.id);

    await Bun.write(join(stage, FILES.session), JSON.stringify(session, null, 2) + "\n");
    await writeJsonl(messages, join(stage, FILES.messages));
    await writeJsonl(parts, join(stage, FILES.parts));
    await writeJsonl(sessionInput, join(stage, FILES.sessionInput));
    await writeJsonl(events, join(stage, FILES.events));

    const { copied } = await copyAttachments(stage, parts, opencodeDataDir);

    const manifest: Manifest = {
      schema_version: SCHEMA_VERSION,
      session_id: session.id,
      title: session.title,
      time_created: session.time_created,
      time_updated: session.time_updated,
      time_archived: now,
      project_id: session.project_id,
      workspace_id: session.workspace_id,
      parent_id: session.parent_id,
      agent: session.agent,
      model: parseModelColumn(session.model),
      tokens: {
        input: session.tokens_input,
        output: session.tokens_output,
        reasoning: session.tokens_reasoning,
        cache_read: session.tokens_cache_read,
        cache_write: session.tokens_cache_write,
      },
      cost: session.cost,
      counts: {
        messages: messages.length,
        parts: parts.length,
        session_input: sessionInput.length,
        events: events.length,
        attachments: copied,
      },
      bytes: {
        messages: sumStringLengths(messages, "data"),
        parts: sumStringLengths(parts, "data"),
        session_input: sumStringLengths(sessionInput, "prompt") + sumStringLengths(sessionInput, "delivery"),
        events: sumStringLengths(events, "data"),
        attachments: copied,
      },
      source_db: opencodeDbPath,
      exported_at: new Date(now).toISOString(),
    };
    // Manifest written last to mark completion.
    await Bun.write(join(stage, FILES.manifest), JSON.stringify(manifest, null, 2) + "\n");

    await rename(stage, target);
    return { ok: true, archiveDir: target, manifest };
  } catch (e) {
    // Best-effort cleanup of staging dir
    try {
      const { rm } = await import("node:fs/promises");
      await rm(stage, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return {
      ok: false,
      reason: "io",
      message: e instanceof Error ? e.message : String(e),
      archiveDir: stage,
    };
  }
}

/**
 * Resolve the opencode data dir (parent of opencode.db). Used to find
 * tool-output/ for attachment copying.
 *
 * Overridable via `OPENCODE_DATA_DIR` env var — useful for tests, and
 * for deployments where the opencode binary lives in a different
 * directory than its database (rare, but happens with the standalone
 * opencode install).
 */
export function opencodeDataDirFromDbPath(dbPath: string): string {
  const override = process.env.OPENCODE_DATA_DIR?.trim();
  if (override) return override;
  return join(dbPath, "..");
}
