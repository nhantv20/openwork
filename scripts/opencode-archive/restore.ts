#!/usr/bin/env bun
/**
 * Read an archived session back as JSON for inspection.
 *
 * Usage:
 *   bun scripts/opencode-archive/restore.ts <sessionId>              # print manifest + counts
 *   bun scripts/opencode-archive/restore.ts <sessionId> --messages   # print messages.jsonl
 *   bun scripts/opencode-archive/restore.ts <sessionId> --parts      # print parts.jsonl
 *   bun scripts/opencode-archive/restore.ts <sessionId> --events     # print events.jsonl
 *   bun scripts/opencode-archive/restore.ts <sessionId> --session   # print session.json
 *   bun scripts/opencode-archive/restore.ts <sessionId> --all       # full JSON dump
 *
 * Looks under $XDG_DATA_HOME/opencode-archive/YYYY-MM/<sessionId>/.
 * If multiple duplicates exist (e.g. ses_xxx/, ses_xxx-dup1/, ...), uses
 * the first match by alphabetical order.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resolvePaths } from "./lib/paths.js";
import { FILES, type Manifest } from "./lib/schema.js";

async function findArchiveDir(archiveRoot: string, sessionId: string): Promise<string | null> {
  // Search all YYYY-MM/ subdirs for a folder starting with the sessionId.
  let monthDirs: string[];
  try {
    monthDirs = await readdir(archiveRoot);
  } catch {
    return null;
  }
  for (const month of monthDirs.sort().reverse()) {
    const monthPath = join(archiveRoot, month);
    let candidates: string[];
    try {
      candidates = await readdir(monthPath);
    } catch {
      continue;
    }
    for (const candidate of candidates.sort()) {
      if (candidate === sessionId || candidate.startsWith(`${sessionId}-dup`)) {
        return join(monthPath, candidate);
      }
    }
  }
  return null;
}

function loadJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as T);
  }
  return out;
}

async function loadJsonlFile<T>(path: string, optional = false): Promise<T[]> {
  try {
    return loadJsonl<T>(await readFile(path, "utf8"));
  } catch (error) {
    if (optional) return [];
    throw error;
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: bun restore.ts <sessionId> [--messages|--parts|--session|--all]");
    return 2;
  }
  const sessionId = args[0] as string;
  const flag = args[1] ?? "--summary";

  const { archiveRoot } = resolvePaths();
  const dir = await findArchiveDir(archiveRoot, sessionId);
  if (!dir) {
    console.error(`archive not found for ${sessionId} under ${archiveRoot}`);
    return 2;
  }

  if (flag === "--summary") {
    const manifest = JSON.parse(await readFile(join(dir, FILES.manifest), "utf8")) as Manifest;
    console.log(JSON.stringify({ dir, manifest }, null, 2));
    return 0;
  }

  if (flag === "--session") {
    const text = await readFile(join(dir, FILES.session), "utf8");
    process.stdout.write(text);
    return 0;
  }

  if (flag === "--messages") {
    const text = await readFile(join(dir, FILES.messages), "utf8");
    const rows = loadJsonl<unknown>(text);
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (flag === "--parts") {
    const text = await readFile(join(dir, FILES.parts), "utf8");
    const rows = loadJsonl<unknown>(text);
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (flag === "--events") {
    const text = await readFile(join(dir, FILES.events), "utf8");
    const rows = loadJsonl<unknown>(text);
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (flag === "--all") {
    const manifest = JSON.parse(await readFile(join(dir, FILES.manifest), "utf8")) as Manifest;
    const session = JSON.parse(await readFile(join(dir, FILES.session), "utf8"));
    const messages = await loadJsonlFile<unknown>(join(dir, FILES.messages));
    const parts = await loadJsonlFile<unknown>(join(dir, FILES.parts));
    const sessionInput = await loadJsonlFile<unknown>(join(dir, FILES.sessionInput));
    const events = await loadJsonlFile<unknown>(join(dir, FILES.events), true);
    console.log(JSON.stringify({ dir, manifest, session, messages, parts, sessionInput, events }, null, 2));
    return 0;
  }

  console.error(`unknown flag: ${flag}`);
  return 2;
}

const isMain = import.meta.path === Bun.main;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(2);
    },
  );
}

export { main };
