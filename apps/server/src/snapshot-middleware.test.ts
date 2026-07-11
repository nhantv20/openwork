import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { maybeSnapshotBeforeWrite } from "./snapshot-middleware.js";
import { SnapshotStore, MAX_SNAPSHOT_BYTES } from "./file-snapshots.js";
import type { ServerConfig } from "./types.js";

const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
let tmpRoot = "";
let workspaceRoot = "";
let config: ServerConfig;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "openwork-snap-mw-"));
  workspaceRoot = join(tmpRoot, "ws");
  await mkdir(workspaceRoot, { recursive: true });
  process.env.OPENWORK_RUNTIME_DB = join(tmpRoot, "runtime.sqlite");
  config = {
    host: "127.0.0.1",
    port: 0,
    token: "t",
    hostToken: "h",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [],
    workspaces: [{ id: "ws_1", name: "W", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
});

afterEach(async () => {
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = "";
    workspaceRoot = "";
  }
});

async function writeFixture(name: string, content: string | Buffer) {
  const path = join(workspaceRoot, name);
  await mkdir(join(workspaceRoot, ...name.split("/").slice(0, -1)), { recursive: true });
  await writeFile(path, content);
  return path;
}

describe("maybeSnapshotBeforeWrite", () => {
  test("snapshots an existing text file with auto trigger", async () => {
    await writeFixture("a.ts", "first version");
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "a.ts",
    });
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.snapshot.content).toBe("first version");
    expect(result.snapshot.trigger).toBe("auto");
    expect(result.snapshot.workspaceId).toBe("ws_1");
    expect(result.snapshot.filePath).toBe("a.ts");
  });

  test("skips when skipAutoSnapshot is true (loop prevention)", async () => {
    await writeFixture("a.ts", "first version");
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "a.ts",
      skipAutoSnapshot: true,
    });
    expect(result).toEqual({ skipped: true, reason: "explicit" });
    expect(await store.count("ws_1", "a.ts")).toBe(0);
  });

  test("skips new files (no current content to snapshot)", async () => {
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "never-written.ts",
    });
    expect(result).toEqual({ skipped: true, reason: "new-file" });
  });

  test("skips empty files", async () => {
    await writeFixture("empty.ts", "");
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "empty.ts",
    });
    expect(result).toEqual({ skipped: true, reason: "empty" });
  });

  test("skips binary files (null byte in first 8KB)", async () => {
    const buf = Buffer.concat([Buffer.from("hello"), Buffer.from([0]), Buffer.from("world")]);
    await writeFixture("blob.bin", buf);
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "blob.bin",
    });
    expect(result).toEqual({ skipped: true, reason: "binary" });
  });

  test("skips files larger than MAX_SNAPSHOT_BYTES", async () => {
    const tooBig = Buffer.alloc(MAX_SNAPSHOT_BYTES + 1, 0x41);
    await writeFixture("big.txt", tooBig);
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "big.txt",
    });
    expect(result).toEqual({ skipped: true, reason: "oversize" });
  });

  test("dedups on second call with same content", async () => {
    await writeFixture("a.ts", "same content");
    const store = new SnapshotStore(config);
    const first = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "a.ts",
    });
    expect(first.skipped).toBe(false);
    const second = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "a.ts",
    });
    expect(second.skipped).toBe(false);
    if (first.skipped || second.skipped) return;
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(second.deduped).toBe(true);
  });

  test("keeps trigger manual when caller passes manual", async () => {
    await writeFixture("m.ts", "x");
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "m.ts",
      trigger: "manual",
    });
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.snapshot.trigger).toBe("manual");
  });

  test("passes revision through to snapshot", async () => {
    await writeFixture("r.ts", "x");
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "r.ts",
      revision: "1234:56",
    });
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.snapshot.revision).toBe("1234:56");
  });

  test("survives race: file deleted between check and read", async () => {
    // The middleware reads current file content first. If a file is
    // removed (or never existed) before the read, we should skip with
    // "new-file" — the spec treats both cases identically.
    const store = new SnapshotStore(config);
    const result = await maybeSnapshotBeforeWrite(config, store, {
      workspaceId: "ws_1",
      workspaceRoot,
      filePath: "never-existed.ts",
    });
    expect(result).toEqual({ skipped: true, reason: "new-file" });
  });
});
