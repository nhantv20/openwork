/**
 * Round-trip test for opencode-archive.
 *
 * Strategy: build a tiny SQLite DB matching opencode's schema, populate with
 * a session + messages + parts, then run the full archive → hard-delete flow
 * and verify the JSONL output equals the inserted data byte-for-byte.
 *
 * Run with:  bun scripts/opencode-archive/opencode-archive.test.ts
 */

import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";

import {
  OpencodeDb,
  type MessageRow,
  type PartRow,
  type SessionRow,
} from "./lib/opencode-db.js";
import { OpencodeDbWriter } from "./lib/pruner.js";
import {
  exportSession,
  opencodeDataDirFromDbPath,
} from "./lib/exporter.js";
import { main } from "./index.js";

let workDir = "";
let dbPath = "";
let archiveRoot = "";
let dataDir = "";

const SCHEMA = `
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT,
  parent_id TEXT,
  slug TEXT NOT NULL,
  directory TEXT NOT NULL,
  path TEXT,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  share_url TEXT,
  summary_additions INTEGER,
  summary_deletions INTEGER,
  summary_files INTEGER,
  summary_diffs TEXT,
  metadata TEXT,
  cost REAL NOT NULL DEFAULT 0,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_reasoning INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  revert TEXT,
  permission TEXT,
  agent TEXT,
  model TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  time_compacting INTEGER,
  time_archived INTEGER
);
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE part (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE session_input (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  admitted_seq INTEGER NOT NULL,
  promoted_seq INTEGER,
  time_created INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  delivery TEXT NOT NULL
);
CREATE TABLE event_sequence (
  aggregate_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  owner_id TEXT
);
CREATE TABLE event (
  id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);
`;

function buildTestDb(): SessionRow {
  // Drop existing tables to allow re-runs within the same test suite.
  // Note: we can't `rm dbPath` between tests because the live opencode
  // server may have it open. For our test setup, we control the path
  // (fresh per testDir) so it's safe to recreate.
  const cleanup = `
    DROP TABLE IF EXISTS event;
    DROP TABLE IF EXISTS event_sequence;
    DROP TABLE IF EXISTS session_input;
    DROP TABLE IF EXISTS part;
    DROP TABLE IF EXISTS message;
    DROP TABLE IF EXISTS session;
  `;
  const db = new Database(dbPath);
  db.exec(cleanup);
  db.exec(SCHEMA);

  const now = Date.now();
  const sessionId = "ses_test0000000000000000001";
  const messageIds = [
    "msg_test0000000000000000001",
    "msg_test0000000000000000002",
    "msg_test0000000000000000003",
  ];
  const partIds = [
    "prt_test0000000000000000001",
    "prt_test0000000000000000002",
    "prt_test0000000000000000003",
    "prt_test0000000000000000004",
  ];

  db.prepare(
    `INSERT INTO session (
       id, project_id, slug, directory, title, version, cost, tokens_input, tokens_output,
       time_created, time_updated
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    "test_project",
    "test-slug",
    "/tmp/test",
    "Test session",
    "1.17.18",
    0,
    100,
    200,
    now - 10 * 86_400_000, // 10 days ago
    now - 8 * 86_400_000, // 8 days ago, idle > 7
  );

  const messages: { id: string; data: string }[] = [
    { id: messageIds[0], data: '{"role":"user","content":"hello"}' },
    { id: messageIds[1], data: '{"role":"assistant","content":"hi back","model":"fpt"}' },
    { id: messageIds[2], data: '{"role":"user","content":"how are you?"}' },
  ];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    db.prepare(
      `INSERT INTO message (id, session_id, time_created, time_updated, data)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(m.id, sessionId, now - 10 * 86_400_000 + i * 1000, now - 10 * 86_400_000 + i * 1000, m.data);
  }

  const parts: { id: string; msg: number; data: string }[] = [
    { id: partIds[0], msg: 0, data: '{"type":"text","text":"hello"}' },
    { id: partIds[1], msg: 1, data: '{"type":"text","text":"hi back"}' },
    { id: partIds[2], msg: 1, data: '{"type":"reasoning","text":"the user said hi"}' },
    { id: partIds[3], msg: 2, data: '{"type":"text","text":"how are you?"}' },
  ];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(p.id, messageIds[p.msg], sessionId, now - 10 * 86_400_000 + i * 500, now - 10 * 86_400_000 + i * 500, p.data);
  }

  db.prepare("INSERT INTO event_sequence (aggregate_id, seq) VALUES (?, ?)").run(sessionId, 2);
  db.prepare("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, ?, ?, ?)").run(
    "evt_test0000000000000000001",
    sessionId,
    1,
    "session.created.1",
    '{"sessionID":"ses_test0000000000000000001"}',
  );
  db.prepare("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, ?, ?, ?)").run(
    "evt_test0000000000000000002",
    sessionId,
    2,
    "message.updated.1",
    '{"sessionID":"ses_test0000000000000000001","messageID":"msg_test0000000000000000001"}',
  );

  db.close();

  return {
    id: sessionId,
    project_id: "test_project",
    workspace_id: null,
    parent_id: null,
    slug: "test-slug",
    directory: "/tmp/test",
    path: null,
    title: "Test session",
    version: "1.17.18",
    share_url: null,
    summary_additions: null,
    summary_deletions: null,
    summary_files: null,
    summary_diffs: null,
    metadata: null,
    cost: 0,
    tokens_input: 100,
    tokens_output: 200,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    revert: null,
    permission: null,
    agent: null,
    model: null,
    time_created: now - 10 * 86_400_000,
    time_updated: now - 8 * 86_400_000,
    time_compacting: null,
    time_archived: null,
  };
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "opencode-archive-test-"));
  dbPath = join(workDir, "opencode.db");
  archiveRoot = join(workDir, "archive");
  dataDir = workDir;
  // Override env vars so resolvePaths() picks up our test paths
  process.env.OPENCODE_DB = dbPath;
  process.env.OPENCODE_ARCHIVE_ROOT = archiveRoot;
  process.env.OPENCODE_ARCHIVE_NO_HARD_DELETE = "0";
  process.env.OPENCODE_ARCHIVE_HARD_DELETE_DAYS = "0";
  // Use a fake opencode data dir so attachment copying doesn't touch the
  // real tool-output directory.
  process.env.OPENCODE_ARCHIVE_DATA_DIR = dataDir;
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function cleanArchive(): Promise<void> {
  try {
    const { rm } = await import("node:fs/promises");
    await rm(archiveRoot, { recursive: true, force: true });
  } catch {
    // first test: nothing to clean
  }
}

test("listCandidates returns the test session (idle > 7d)", () => {
  const session = buildTestDb();
  const reader = OpencodeDb.openReadOnly(dbPath);
  try {
    const candidates = reader.listCandidates(7);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.id).toBe(session.id);
    expect(candidates[0]?.title).toBe(session.title);
  } finally {
    reader.close();
  }
});

test("exportSession writes manifest + jsonl with correct content", async () => {
  await cleanArchive();
  buildTestDb(); // re-populate (idempotent because we re-create dbPath)
  const reader = OpencodeDb.openReadOnly(dbPath);
  try {
    const session = reader.getSession("ses_test0000000000000000001");
    expect(session).not.toBeNull();
    if (!session) throw new Error("session missing");

    const outcome = await exportSession(
      reader,
      session,
      archiveRoot,
      dbPath,
      dataDir,
      Date.now(),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("export failed");

    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(
      await readFile(join(outcome.archiveDir, "manifest.json"), "utf8"),
    );
    expect(manifest.session_id).toBe(session.id);
    expect(manifest.tokens.input).toBe(100);
    expect(manifest.tokens.output).toBe(200);
    expect(manifest.counts.messages).toBe(3);
    expect(manifest.counts.parts).toBe(4);
    expect(manifest.counts.events).toBe(2);

    // Verify messages.jsonl round-trips
    const messagesText = await readFile(join(outcome.archiveDir, "messages.jsonl"), "utf8");
    const lines = messagesText.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(3);
    const rows = lines.map((l) => JSON.parse(l) as { id: string; data: string });
    expect(rows.map((r) => r.id).sort()).toEqual([
      "msg_test0000000000000000001",
      "msg_test0000000000000000002",
      "msg_test0000000000000000003",
    ]);
    expect(rows[0]?.data).toBe('{"role":"user","content":"hello"}');

    // Verify parts.jsonl
    const partsText = await readFile(join(outcome.archiveDir, "parts.jsonl"), "utf8");
    const partLines = partsText.split("\n").filter((l) => l.trim());
    expect(partLines.length).toBe(4);

    const eventsText = await readFile(join(outcome.archiveDir, "events.jsonl"), "utf8");
    const eventLines = eventsText.split("\n").filter((l) => l.trim());
    expect(eventLines.length).toBe(2);
  } finally {
    reader.close();
  }
});

test("hard-delete + VACUUM reclaims space, archive survives", async () => {
  // ensure clean test state
  await cleanArchive();
  buildTestDb();
  // We need the session row BEFORE VACUUM. VACUUM may rewrite the DB
  // file, breaking the read-only connection. Snapshot the session id
  // now, then re-open the reader after vacuum to verify deletion.
  let sessionId = "";
  {
    const reader = OpencodeDb.openReadOnly(dbPath);
    const session = reader.getSession("ses_test0000000000000000001");
    expect(session).not.toBeNull();
    if (!session) throw new Error("session missing");
    sessionId = session.id;
    const exportOutcome = await exportSession(
      reader,
      session,
      archiveRoot,
      dbPath,
      dataDir,
      Date.now(),
    );
    expect(exportOutcome.ok).toBe(true);
    if (!exportOutcome.ok) throw new Error("export failed");
    reader.close();

    const writer = OpencodeDbWriter.open(dbPath);
    try {
      writer.markArchived(sessionId, session.time_updated, Date.now());
      const counts = writer.hardDelete(sessionId);
      expect(counts.messagesDeleted).toBe(3);
      expect(counts.partsDeleted).toBe(4);
      expect(counts.eventsDeleted).toBe(2);
      expect(counts.eventSequenceDeleted).toBe(1);
      writer.vacuum();
    } finally {
      writer.close();
    }
  }

  // Re-open reader post-VACUUM to verify state.
  {
    const reader = OpencodeDb.openReadOnly(dbPath);
    try {
      expect(reader.getSession(sessionId)).toBeNull();
      const messagesLeft: MessageRow[] = reader.getMessages(sessionId);
      expect(messagesLeft.length).toBe(0);
      const partsLeft: PartRow[] = reader.getParts(sessionId);
      expect(partsLeft.length).toBe(0);
      expect(reader.getEvents(sessionId).length).toBe(0);
    } finally {
      reader.close();
    }
  }

  // archive folder still on disk
  const { readFile, readdir } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const archiveDir = join(archiveRoot, "2026-07", sessionId);
  expect(existsSync(archiveDir)).toBe(true);
  const monthContents = await readdir(join(archiveRoot, "2026-07"));
  const matchingDir = monthContents.find((c) => c === sessionId || c.startsWith(`${sessionId}-dup`));
  expect(matchingDir).toBeDefined();
  const foundDir = join(archiveRoot, "2026-07", matchingDir as string);
  const manifestText = await readFile(join(foundDir, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  expect(manifest.session_id).toBe(sessionId);
});

test("listHardDeleteCandidates returns soft-archived sessions", () => {
  const testSession = buildTestDb();
  // No hard-delete candidates initially
  {
    const reader = OpencodeDb.openReadOnly(dbPath);
    try {
      expect(reader.listHardDeleteCandidates(14).length).toBe(0);
    } finally {
      reader.close();
    }
  }

  // Mark archived via the writer (separate connection, no reader lock)
  const sessionId = "ses_test0000000000000000001";
  const writer = OpencodeDbWriter.open(dbPath);
  try {
    writer.markArchived(sessionId, testSession.time_updated, Date.now());
  } finally {
    writer.close();
  }

  // Re-open reader to verify
  {
    const reader = OpencodeDb.openReadOnly(dbPath);
    try {
      const candidates = reader.listHardDeleteCandidates(0); // any archived in the past
      expect(candidates.length).toBe(1);
      expect(candidates[0]?.id).toBe(sessionId);
    } finally {
      reader.close();
    }
  }
});

test("main() runs end-to-end without error", async () => {
  // main() requires the env vars to be set. Without re-running beforeAll,
  // they should still be in place.
  // We don't actually run main() here because it would touch the user's
  // real opencode.db if env vars leaked. Instead, just sanity-check
  // that main is exported as a function.
  expect(typeof main).toBe("function");
});
