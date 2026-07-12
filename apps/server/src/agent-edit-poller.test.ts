/**
 * Integration tests for the agent-edit poller. Uses a real tempdir
 * and a real SnapshotStore so we exercise the end-to-end "OpenCode
 * edits a file outside our HTTP handlers → poller snapshots it"
 * loop.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentEditDetector } from "./agent-edit-detector.js";
import { startAgentEditPoller } from "./agent-edit-poller.js";
import { SnapshotStore } from "./file-snapshots.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

const baseConfig: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  token: "t",
  hostToken: "h",
  approval: { mode: "auto", timeoutMs: 1000 },
  corsOrigins: ["*"],
  workspaces: [],
  authorizedRoots: [],
  readOnly: false,
  startedAt: Date.now(),
  tokenSource: "cli",
  hostTokenSource: "cli",
  logFormat: "pretty",
  logRequests: false,
};

let tmpRoot = "";
let workspaceRoot = "";
let store: SnapshotStore;
let detector: AgentEditDetector;
let dbPath = "";

const silentLogger = { warn: () => {} };

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "openwork-agent-poller-"));
  workspaceRoot = join(tmpRoot, "ws");
  await mkdir(workspaceRoot, { recursive: true });
  dbPath = join(tmpRoot, "runtime.sqlite");
  process.env.OPENWORK_RUNTIME_DB = dbPath;
  store = new SnapshotStore({ ...baseConfig });
  detector = new AgentEditDetector(baseConfig);
});

afterEach(async () => {
  detector.stop();
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

const ws = (id = "ws_1"): WorkspaceInfo => ({
  id,
  name: "ws",
  path: workspaceRoot,
  preset: "starter",
  workspaceType: "local",
});

describe("startAgentEditPoller", () => {
  test("first scan seeds baseline; no snapshots", async () => {
    await writeFile(join(workspaceRoot, "foo.ts"), "v1", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000, // we only want to run the immediate tick
      logger: silentLogger,
    });
    try {
      const count = await poller.scanWorkspace("ws_1");
      expect(count).toBe(0);
      expect(detector.getLastSeen("ws_1", "foo.ts")).toEqual({ mtimeMs: expect.any(Number), size: 2 });
    } finally {
      poller.stop();
    }
  });

  test("external write after baseline triggers an agent snapshot", async () => {
    await writeFile(join(workspaceRoot, "foo.ts"), "v1", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000,
      logger: silentLogger,
    });
    try {
      await poller.scanWorkspace("ws_1");
      // Simulate an external edit (OpenCode, vim, etc.).
      await new Promise((r) => setTimeout(r, 10)); // mtime resolution
      await writeFile(join(workspaceRoot, "foo.ts"), "v2 from agent", "utf8");
      const count = await poller.scanWorkspace("ws_1");
      expect(count).toBe(1);

      const history = await store.list("ws_1", "foo.ts", { limit: 10 });
      expect(history.length).toBe(1);
      expect(history[0].trigger).toBe("agent");
      expect(history[0].content).toBe("v2 from agent");
    } finally {
      poller.stop();
    }
  });

  test("HTTP-marked write is NOT double-snapshotted", async () => {
    await writeFile(join(workspaceRoot, "foo.ts"), "v1", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000,
      logger: silentLogger,
    });
    try {
      // Seed baseline.
      await poller.scanWorkspace("ws_1");

      // Simulate the file write handler: mark HTTP, then write.
      detector.markHttpWrite("ws_1", "foo.ts");
      await writeFile(join(workspaceRoot, "foo.ts"), "v2 from http", "utf8");

      const count = await poller.scanWorkspace("ws_1");
      expect(count).toBe(0); // classified as "http" — middleware's job
      // The marker is consumed; next cycle would see "agent" but
      // nothing has changed.
      expect(detector.getLastSeen("ws_1", "foo.ts")).toEqual({ mtimeMs: expect.any(Number), size: 12 });
    } finally {
      poller.stop();
    }
  });

  test("file deletion removes the lastSeen entry", async () => {
    await writeFile(join(workspaceRoot, "foo.ts"), "v1", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000,
      logger: silentLogger,
    });
    try {
      await poller.scanWorkspace("ws_1");
      expect(detector.trackedFiles("ws_1")).toContain("foo.ts");

      await rm(join(workspaceRoot, "foo.ts"));
      await poller.scanWorkspace("ws_1");
      expect(detector.trackedFiles("ws_1")).not.toContain("foo.ts");
    } finally {
      poller.stop();
    }
  });

  test("binary file edit is not snapshotted", async () => {
    await writeFile(join(workspaceRoot, "blob.bin"), "text placeholder", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000,
      logger: silentLogger,
    });
    try {
      await poller.scanWorkspace("ws_1");
      await new Promise((r) => setTimeout(r, 10));
      await writeFile(join(workspaceRoot, "blob.bin"), Buffer.from([0, 1, 2, 3, 4]));
      const count = await poller.scanWorkspace("ws_1");
      expect(count).toBe(0);
    } finally {
      poller.stop();
    }
  });

  test("empty file edit is not snapshotted", async () => {
    await writeFile(join(workspaceRoot, "foo.ts"), "v1", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000,
      logger: silentLogger,
    });
    try {
      await poller.scanWorkspace("ws_1");
      await new Promise((r) => setTimeout(r, 10));
      await writeFile(join(workspaceRoot, "foo.ts"), "", "utf8");
      const count = await poller.scanWorkspace("ws_1");
      expect(count).toBe(0);
    } finally {
      poller.stop();
    }
  });

  test("deduplicates: a second agent edit to identical content is a no-op", async () => {
    await writeFile(join(workspaceRoot, "foo.ts"), "v1", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000,
      logger: silentLogger,
    });
    try {
      await poller.scanWorkspace("ws_1");
      await new Promise((r) => setTimeout(r, 10));
      await writeFile(join(workspaceRoot, "foo.ts"), "v2", "utf8");
      const c1 = await poller.scanWorkspace("ws_1");
      expect(c1).toBe(1);
      // Restore the exact same content; the dedup index should make
      // the snapshot a no-op.
      const historyBefore = await store.list("ws_1", "foo.ts", { limit: 10 });
      await new Promise((r) => setTimeout(r, 10));
      await writeFile(join(workspaceRoot, "foo.ts"), "v2-tampered-mtime", "utf8");
      // Restore content immediately after mtime change so the poller
      // sees the v2 mtime but the file is still v2 in content.
      await writeFile(join(workspaceRoot, "foo.ts"), "v2", "utf8");
      const c2 = await poller.scanWorkspace("ws_1");
      const historyAfter = await store.list("ws_1", "foo.ts", { limit: 10 });
      // We only care that no extra snapshot was inserted.
      expect(historyAfter.length).toBe(historyBefore.length);
      // c2 may be 0 (dedup) or 1 (mtime saw a change but content dedup);
      // we just want to verify no extra rows beyond the first cycle.
      expect(c2 === 0 || c2 === 1).toBe(true);
    } finally {
      poller.stop();
    }
  });

  test("scans nested directories", async () => {
    await mkdir(join(workspaceRoot, "src", "lib"), { recursive: true });
    await writeFile(join(workspaceRoot, "src", "lib", "deep.ts"), "v1", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000,
      logger: silentLogger,
    });
    try {
      await poller.scanWorkspace("ws_1");
      expect(detector.trackedFiles("ws_1")).toContain("src/lib/deep.ts");
    } finally {
      poller.stop();
    }
  });

  test("skips .git/ and node_modules/", async () => {
    await mkdir(join(workspaceRoot, ".git"), { recursive: true });
    await mkdir(join(workspaceRoot, "node_modules", "x"), { recursive: true });
    await writeFile(join(workspaceRoot, ".git", "HEAD"), "ref: refs/heads/main", "utf8");
    await writeFile(join(workspaceRoot, "node_modules", "x", "index.js"), "module.exports = 1;", "utf8");
    const poller = startAgentEditPoller({
      config: { ...baseConfig, workspaces: [ws()] },
      workspaces: [ws()],
      store,
      detector,
      pollIntervalMs: 60_000,
      logger: silentLogger,
    });
    try {
      await poller.scanWorkspace("ws_1");
      const files = detector.trackedFiles("ws_1");
      expect(files).not.toContain(".git/HEAD");
      expect(files).not.toContain("node_modules/x/index.js");
    } finally {
      poller.stop();
    }
  });
});
