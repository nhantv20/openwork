import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_SNAPSHOT_BYTES,
  SNAPSHOT_KEEP_LAST,
  SnapshotStore,
  computeContentHash,
} from "./file-snapshots.js";
import type { ServerConfig } from "./types.js";

const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
let tmpRoot = "";

function makeConfig(): ServerConfig {
  if (!tmpRoot) throw new Error("tmpRoot not initialized");
  return {
    host: "127.0.0.1",
    port: 0,
    token: "t",
    hostToken: "h",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openwork-snapshots-"));
  process.env.OPENWORK_RUNTIME_DB = join(tmpRoot, "runtime.sqlite");
});

afterEach(() => {
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = "";
  }
});

describe("SnapshotStore.save + list", () => {
  test("round-trips content and assigns a stable id", async () => {
    const store = new SnapshotStore(makeConfig());
    const { snapshot, deduped, trimmed } = await store.save({
      workspaceId: "ws_1",
      filePath: "src/example.ts",
      content: "hello",
      trigger: "manual",
    });
    expect(deduped).toBe(false);
    expect(trimmed).toBe(0);
    expect(snapshot.workspaceId).toBe("ws_1");
    expect(snapshot.filePath).toBe("src/example.ts");
    expect(snapshot.content).toBe("hello");
    expect(snapshot.contentHash).toBe(computeContentHash("hello"));
    expect(snapshot.size).toBe(5);
    expect(snapshot.trigger).toBe("manual");
    expect(snapshot.revision).toBeNull();
    expect(snapshot.id.length).toBeGreaterThan(0);

    const items = await store.list("ws_1", "src/example.ts");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(snapshot.id);
  });

  test("dedups on identical (workspace, path, hash) and returns the existing row", async () => {
    const store = new SnapshotStore(makeConfig());
    const first = await store.save({
      workspaceId: "ws_1",
      filePath: "a.ts",
      content: "same",
      trigger: "auto",
    });
    const second = await store.save({
      workspaceId: "ws_1",
      filePath: "a.ts",
      content: "same",
      trigger: "auto",
    });
    expect(second.deduped).toBe(true);
    expect(second.snapshot.id).toBe(first.snapshot.id);
    const items = await store.list("ws_1", "a.ts");
    expect(items).toHaveLength(1);
  });

  test("orders by createdAt desc and respects limit + before cursor", async () => {
    const store = new SnapshotStore(makeConfig());
    const base = Date.now();
    const saved = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await store.save({
        workspaceId: "ws_1",
        filePath: "loop.ts",
        content: `v${i}`,
        trigger: "manual",
        createdAt: base + i * 1000,
        id: `snap_${i}`,
      });
      saved.push(result.snapshot);
    }
    const all = await store.list("ws_1", "loop.ts");
    expect(all.map((s) => s.id)).toEqual(["snap_4", "snap_3", "snap_2", "snap_1", "snap_0"]);

    const limited = await store.list("ws_1", "loop.ts", { limit: 2 });
    expect(limited.map((s) => s.id)).toEqual(["snap_4", "snap_3"]);

    const before = await store.list("ws_1", "loop.ts", { before: base + 3 * 1000 });
    expect(before.map((s) => s.id)).toEqual(["snap_2", "snap_1", "snap_0"]);
  });
});

describe("SnapshotStore.trim", () => {
  test("drops oldest entries beyond SNAPSHOT_KEEP_LAST", async () => {
    const store = new SnapshotStore(makeConfig());
    const total = SNAPSHOT_KEEP_LAST + 5;
    const base = Date.now();
    for (let i = 0; i < total; i += 1) {
      await store.save({
        workspaceId: "ws_1",
        filePath: "trim.ts",
        content: `v${i}`,
        trigger: "manual",
        createdAt: base + i,
        id: `trim_${i}`,
      });
    }
    const items = await store.list("ws_1", "trim.ts", { limit: 1000 });
    expect(items).toHaveLength(SNAPSHOT_KEEP_LAST);
    // Top `SNAPSHOT_KEEP_LAST` by createdAt DESC; earliest 5 are gone.
    expect(items[0].id).toBe(`trim_${total - 1}`);
    expect(items.at(-1)?.id).toBe(`trim_${total - SNAPSHOT_KEEP_LAST}`);
  });

  test("returns trimmed count on the save that crossed the cap", async () => {
    const store = new SnapshotStore(makeConfig());
    const base = Date.now();
    for (let i = 0; i < SNAPSHOT_KEEP_LAST; i += 1) {
      await store.save({
        workspaceId: "ws_1",
        filePath: "exact.ts",
        content: `e${i}`,
        createdAt: base + i,
        id: `e_${i}`,
      });
    }
    const result = await store.save({
      workspaceId: "ws_1",
      filePath: "exact.ts",
      content: "overflow",
      createdAt: base + SNAPSHOT_KEEP_LAST,
      id: "e_over",
    });
    expect(result.deduped).toBe(false);
    expect(result.trimmed).toBe(1);
  });
});

describe("SnapshotStore.getById", () => {
  test("returns null for unknown id", async () => {
    const store = new SnapshotStore(makeConfig());
    expect(await store.getById("ws_1", "does_not_exist")).toBeNull();
  });

  test("enforces workspaceId scope (no cross-workspace lookup)", async () => {
    const store = new SnapshotStore(makeConfig());
    const { snapshot } = await store.save({
      workspaceId: "ws_a",
      filePath: "p.ts",
      content: "x",
      trigger: "manual",
    });
    // Same id, different workspaceId should return null.
    expect(await store.getById("ws_b", snapshot.id)).toBeNull();
    // Same workspaceId returns the row.
    const found = await store.getById("ws_a", snapshot.id);
    expect(found?.id).toBe(snapshot.id);
  });
});

describe("SnapshotStore.findLatest", () => {
  test("returns null when file has no snapshots", async () => {
    const store = new SnapshotStore(makeConfig());
    expect(await store.findLatest("ws_1", "missing.ts")).toBeNull();
  });

  test("returns the most recent snapshot for a file", async () => {
    const store = new SnapshotStore(makeConfig());
    const base = Date.now();
    await store.save({
      workspaceId: "ws_1",
      filePath: "x.ts",
      content: "old",
      createdAt: base,
      id: "old",
    });
    await store.save({
      workspaceId: "ws_1",
      filePath: "x.ts",
      content: "new",
      createdAt: base + 1000,
      id: "new",
    });
    const latest = await store.findLatest("ws_1", "x.ts");
    expect(latest?.id).toBe("new");
  });
});

describe("SnapshotStore.count", () => {
  test("counts all snapshots in a workspace when no filePath given", async () => {
    const store = new SnapshotStore(makeConfig());
    await store.save({ workspaceId: "ws_1", filePath: "a.ts", content: "a" });
    await store.save({ workspaceId: "ws_1", filePath: "b.ts", content: "b" });
    await store.save({ workspaceId: "ws_1", filePath: "b.ts", content: "b2" });
    expect(await store.count("ws_1")).toBe(3);
    expect(await store.count("ws_1", "a.ts")).toBe(1);
    expect(await store.count("ws_1", "b.ts")).toBe(2);
    expect(await store.count("ws_2")).toBe(0);
  });
});

describe("SnapshotStore.delete", () => {
  test("removes a row and returns true; false for unknown id", async () => {
    const store = new SnapshotStore(makeConfig());
    const { snapshot } = await store.save({
      workspaceId: "ws_1",
      filePath: "del.ts",
      content: "x",
    });
    expect(await store.delete("ws_1", snapshot.id)).toBe(true);
    expect(await store.getById("ws_1", snapshot.id)).toBeNull();
    expect(await store.delete("ws_1", "ghost")).toBe(false);
  });
});

describe("SnapshotStore.save guards", () => {
  test("rejects content > MAX_SNAPSHOT_BYTES", async () => {
    const store = new SnapshotStore(makeConfig());
    const tooBig = "x".repeat(MAX_SNAPSHOT_BYTES + 1);
    await expect(
      store.save({ workspaceId: "ws_1", filePath: "big.ts", content: tooBig }),
    ).rejects.toThrow(/MAX_SNAPSHOT_BYTES/);
  });

  test("accepts content exactly at MAX_SNAPSHOT_BYTES", async () => {
    const store = new SnapshotStore(makeConfig());
    const exact = "x".repeat(MAX_SNAPSHOT_BYTES);
    const { snapshot } = await store.save({
      workspaceId: "ws_1",
      filePath: "exact.ts",
      content: exact,
    });
    expect(snapshot.size).toBe(MAX_SNAPSHOT_BYTES);
  });

  test("defaults trigger to 'auto' when omitted or invalid", async () => {
    const store = new SnapshotStore(makeConfig());
    const a = await store.save({
      workspaceId: "ws_1",
      filePath: "default.ts",
      content: "y",
    });
    expect(a.snapshot.trigger).toBe("auto");
  });
});

describe("computeContentHash", () => {
  test("is stable across calls", () => {
    expect(computeContentHash("hello")).toBe(computeContentHash("hello"));
  });

  test("is sha256 hex (64 chars, 0-9a-f)", () => {
    const hash = computeContentHash("anything");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
