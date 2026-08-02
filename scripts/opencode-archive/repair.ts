#!/usr/bin/env bun

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { OpencodeDb } from "./lib/opencode-db.js";
import { exportSession, opencodeDataDirFromDbPath } from "./lib/exporter.js";
import { archiveDirFor, FILES, type Manifest } from "./lib/schema.js";
import { resolvePaths } from "./lib/paths.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function repairArchive(): Promise<void> {
  const paths = resolvePaths();
  const reader = OpencodeDb.openReadOnly(paths.opencodeDb);
  let repaired = 0;
  let exported = 0;
  let refused = 0;

  try {
    const ids = reader.db
      .query<{ id: string }, []>("SELECT id FROM session WHERE time_archived IS NOT NULL ORDER BY time_created ASC")
      .all();

    for (const { id } of ids) {
      const session = reader.getSession(id);
      if (!session) continue;
      const archiveDir = archiveDirFor(paths.archiveRoot, session.time_created, session.id);
      const manifestPath = join(archiveDir, FILES.manifest);

      if (!(await exists(manifestPath))) {
        const outcome = await exportSession(
          reader,
          session,
          paths.archiveRoot,
          opencodeDataDirFromDbPath(paths.opencodeDb),
          paths.opencodeDb,
        );
        if (outcome.ok) {
          exported++;
          console.log(`[repair] exported ${id}`);
        } else {
          refused++;
          console.error(`[repair] refused ${id}: ${outcome.reason}`);
        }
        continue;
      }

      const eventsPath = join(archiveDir, FILES.events);
      if (await exists(eventsPath)) continue;

      const events = reader.getEvents(id);
      const eventsText = events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : "");
      await Bun.write(eventsPath, eventsText);

      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
      manifest.counts.events = events.length;
      manifest.bytes.events = events.reduce((total, event) => total + event.data.length, 0);
      await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      repaired++;
      console.log(`[repair] added events to ${id} (${events.length} rows)`);
    }
  } finally {
    reader.close();
  }

  console.log(JSON.stringify({ db: paths.opencodeDb, archiveRoot: paths.archiveRoot, repaired, exported, refused }, null, 2));
  if (refused > 0) process.exitCode = 2;
}

repairArchive().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 2;
});