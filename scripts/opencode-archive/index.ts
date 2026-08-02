#!/usr/bin/env bun
/**
 * opencode-archive — rotate old sessions out of the live opencode.db.
 *
 * Usage:
 *   bun scripts/opencode-archive/index.ts                       # default: archive idle >=7d, hard-delete soft-archived >=14d
 *   bun scripts/opencode-archive/index.ts --workspace <path>     # archive to <path>/.opencode/archive/ (Phase 2)
 *   OPENCODE_ARCHIVE_DAYS=3 bun scripts/opencode-archive/index.ts
 *   OPENCODE_ARCHIVE_HARD_DELETE_DAYS=7 bun scripts/opencode-archive/index.ts
 *   OPENCODE_ARCHIVE_DRY_RUN=1 bun scripts/opencode-archive/index.ts
 *   OPENCODE_ARCHIVE_NO_VACUUM=1 bun scripts/opencode-archive/index.ts
 *   OPENCODE_ARCHIVE_NO_HARD_DELETE=1 bun scripts/opencode-archive/index.ts
 *
 * Exit codes:
 *   0  — success (some or no work done)
 *   2  — I/O error during archive; see stderr
 *   3  — Safety-net refusal (would delete session without archive folder)
 */

import { resolve } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { resolvePaths } from "./lib/paths.js";
import { OpencodeDb, liveDbByteSize } from "./lib/opencode-db.js";
import {
  exportSession,
  opencodeDataDirFromDbPath,
  type ExportOutcome,
} from "./lib/exporter.js";
import {
  OpencodeDbWriter,
  directorySize,
} from "./lib/pruner.js";
import type { Manifest } from "./lib/schema.js";

const envInt = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const envBool = (env: NodeJS.ProcessEnv, name: string): boolean => {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

type CliOptions = { workspacePath?: string };

/**
 * Parse argv. Only `--workspace <path>` is supported; everything else is
 * ignored. Env vars remain the source of truth for archive days / dry-run.
 */
function parseCliArgs(argv: string[]): CliOptions {
  const out: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace" || arg === "-w") {
      const next = argv[++i];
      if (next) out.workspacePath = resolve(next);
    } else if (arg?.startsWith("--workspace=")) {
      out.workspacePath = resolve(arg.slice("--workspace=".length));
    }
  }
  return out;
}

export async function main(
  cliOptions: CliOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const paths = resolvePaths({ workspacePath: cliOptions.workspacePath });
  const idleDays = envInt(env, "OPENCODE_ARCHIVE_DAYS", 7);
  const hardDeleteDays = envInt(env, "OPENCODE_ARCHIVE_HARD_DELETE_DAYS", 14);
  const dryRun = envBool(env, "OPENCODE_ARCHIVE_DRY_RUN");
  const noVacuum = envBool(env, "OPENCODE_ARCHIVE_NO_VACUUM");
  const noHardDelete = envBool(env, "OPENCODE_ARCHIVE_NO_HARD_DELETE");

  console.log(`[archive] db=${paths.opencodeDb}`);
  console.log(`[archive] scope=${paths.scope} archiveRoot=${paths.archiveRoot}${paths.workspacePath ? ` workspacePath=${paths.workspacePath}` : ""}`);
  console.log(`[archive] idleDays=${idleDays} hardDeleteDays=${hardDeleteDays} dryRun=${dryRun} noVacuum=${noVacuum} noHardDelete=${noHardDelete}`);

  const sizeBefore = liveDbByteSize(paths.opencodeDb);
  console.log(`[archive] db size before: ${formatBytes(sizeBefore)}`);

  const reader = OpencodeDb.openReadOnly(paths.opencodeDb);
  let writer: OpencodeDbWriter | null = null;

  try {
    const candidates = reader.listCandidates(idleDays);
    console.log(`[archive] idle candidates: ${candidates.length}`);

    const archivedNow: Manifest[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const s of candidates) {
      if (dryRun) {
        console.log(`[archive]   [dry-run] would archive: ${s.id}  ${truncate(s.title, 60)}  updated=${new Date(s.time_updated).toISOString()}`);
        continue;
      }
      const outcome: ExportOutcome = await exportSession(
        reader,
        s,
        paths.archiveRoot,
        paths.opencodeDb,
        opencodeDataDirFromDbPath(paths.opencodeDb),
      );
      if (outcome.ok) {
        if (!writer) writer = OpencodeDbWriter.open(paths.opencodeDb);
          const marked = writer.markArchived(s.id, s.time_updated, outcome.manifest.time_archived);
          if (!marked) {
            await rm(outcome.archiveDir, { recursive: true, force: true });
            failed.push({ id: s.id, error: "session changed while exporting; archive discarded" });
            console.error(`[archive]   RETRY: ${s.id} changed while exporting`);
            continue;
          }
          archivedNow.push(outcome.manifest);
        console.log(`[archive]   archived: ${s.id}  ${truncate(s.title, 60)}  → ${outcome.archiveDir}`);
      } else if (outcome.reason === "already-archived") {
        skipped.push({ id: s.id, reason: "already-archived" });
        console.log(`[archive]   skip: ${s.id}  already archived at ${outcome.archiveDir}`);
      } else if (outcome.reason === "session-not-found") {
        skipped.push({ id: s.id, reason: "session-not-found" });
      } else {
        failed.push({ id: s.id, error: outcome.message });
        console.error(`[archive]   FAILED: ${s.id}  ${outcome.message}`);
      }
    }

    let hardDeleted = 0;
    let hardDeleteCandidates = 0;
    let hardDeleteFreed = 0;
    let hardDeleteRefused = 0;
    let archiveFolderSize = 0;

    if (!noHardDelete) {
      const hardCandidates = reader.listHardDeleteCandidates(hardDeleteDays);
      hardDeleteCandidates = hardCandidates.length;
      console.log(`[archive] hard-delete candidates (soft-archived >=${hardDeleteDays}d): ${hardDeleteCandidates}`);

      if (hardCandidates.length > 0) {
        if (!writer) writer = OpencodeDbWriter.open(paths.opencodeDb);

        for (const s of hardCandidates) {
          const archiveDir = `${paths.archiveRoot}/${yearMonth(s.time_created)}/${s.id}`;
            if (!(await hasCompleteArchive(archiveDir, s.id))) {
            console.error(`[archive]   REFUSE: ${s.id}  no archive folder at ${archiveDir}`);
            hardDeleteRefused++;
            continue;
          }
          if (dryRun) {
            console.log(`[archive]   [dry-run] would hard-delete: ${s.id}`);
            continue;
          }
          const counts = writer.hardDelete(s.id);
          hardDeleted++;
          hardDeleteFreed += counts.messagesDeleted + counts.partsDeleted + counts.sessionInputDeleted;
          console.log(`[archive]   hard-deleted: ${s.id}  (${counts.messagesDeleted} msg, ${counts.partsDeleted} parts, ${counts.sessionInputDeleted} input rows, ${counts.eventsDeleted} events)`);
        }
      }
    }

    if (!noVacuum && hardDeleted > 0 && !dryRun && writer) {
      console.log(`[archive] running VACUUM...`);
      const t0 = performance.now();
      writer.vacuum();
      console.log(`[archive] VACUUM done in ${Math.round(performance.now() - t0)}ms`);
    }

    if (writer) writer.close();
    reader.close();

    if (archivedNow.length > 0) {
      let bytes = 0;
      for (const m of archivedNow) {
        bytes += await directorySize(`${paths.archiveRoot}/${yearMonth(m.time_created)}/${m.session_id}`);
      }
      archiveFolderSize = bytes;
    }

    const sizeAfter = liveDbByteSize(paths.opencodeDb);
    const report = {
      db: paths.opencodeDb,
      archiveRoot: paths.archiveRoot,
      scope: paths.scope,
      workspacePath: paths.workspacePath,
      idleDays,
      hardDeleteDays,
      dryRun,
      sizeBefore,
      sizeAfter,
      bytesReclaimed: sizeBefore - sizeAfter,
      archivedThisRun: archivedNow.length,
      hardDeletedThisRun: hardDeleted,
      hardDeleteCandidates,
      hardDeleteRefused,
      archiveFolderSize,
      skipped,
      failed,
    };
    console.log(`[archive] done.`);
    console.log(JSON.stringify(report, null, 2));
    if (failed.length > 0) return 2;
    if (hardDeleteRefused > 0) return 3;
    return 0;
  } catch (e) {
    console.error(`[archive] fatal:`, e);
    return 2;
  } finally {
    if (writer) {
      try {
        writer.close();
      } catch {
        // ignore
      }
    }
    reader.close();
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function yearMonth(timeCreated: number): string {
  const d = new Date(timeCreated);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function hasCompleteArchive(archiveDir: string, sessionId: string): Promise<boolean> {
  if (!(await exists(archiveDir))) return false;
  try {
    const manifest = JSON.parse(await readFile(resolve(archiveDir, "manifest.json"), "utf8")) as {
      session_id?: unknown;
      counts?: { events?: unknown };
    };
    return manifest.session_id === sessionId
      && typeof manifest.counts?.events === "number"
      && await exists(resolve(archiveDir, "events.jsonl"));
  } catch {
    return false;
  }
}

// Run only when invoked directly (not when imported for testing).
const isMain = import.meta.path === Bun.main;
if (isMain) {
  const cliOptions = parseCliArgs(process.argv.slice(2));
  main(cliOptions).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(2);
    },
  );
}

export { parseCliArgs };
