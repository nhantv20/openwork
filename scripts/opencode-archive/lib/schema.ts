/**
 * On-disk schema for archived opencode sessions.
 *
 * One folder per session, nested under `YYYY-MM/<sessionId>/`. Manifest is
 * written LAST so a half-written folder is detectable as a failed archive
 * (and safe to re-run, since the pruner never deletes without a manifest).
 */

export const SCHEMA_VERSION = 1 as const;

export type Manifest = {
  schema_version: typeof SCHEMA_VERSION;
  session_id: string;
  title: string;
  time_created: number;
  time_updated: number;
  time_archived: number;
  project_id: string;
  workspace_id: string | null;
  parent_id: string | null;
  agent: string | null;
  model: { provider_id: string; model_id: string } | null;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache_read: number;
    cache_write: number;
  };
  cost: number;
  counts: {
    messages: number;
    parts: number;
    session_input: number;
    events: number;
    attachments: number;
  };
  bytes: {
    messages: number;
    parts: number;
    session_input: number;
    events: number;
    attachments: number;
  };
  /** Absolute path of the opencode.db at export time, for debugging. */
  source_db: string;
  /** Iso8601 string of when this archive was written. */
  exported_at: string;
};

/**
 * One row per session_message (or message) — a transcript turn. The data
 * column is the full original JSON string so round-trip is lossless.
 */
export type MessageRow = {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
};

/**
 * One row per part (text/tool/reasoning/patch/snapshot). data is the
 * original JSON string. snapshot parts may reference attachments; those
 * are copied into attachments/ and listed in manifest.counts.attachments.
 */
export type PartRow = {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
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

export type EventRow = {
  id: string;
  aggregate_id: string;
  seq: number;
  type: string;
  data: string;
};

/**
 * Build the on-disk folder path for a given session. Grouped by the
 * session's time_created month so `ls ~/opencode-archive/2026-07/` shows
 * everything from July.
 */
export function archiveDirFor(archiveRoot: string, timeCreated: number, sessionId: string): string {
  const d = new Date(timeCreated);
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${archiveRoot}/${yyyy}-${mm}/${sessionId}`;
}

export const FILES = {
  manifest: "manifest.json",
  session: "session.json",
  messages: "messages.jsonl",
  parts: "parts.jsonl",
  sessionInput: "session_input.jsonl",
  events: "events.jsonl",
  attachmentsDir: "attachments",
} as const;
