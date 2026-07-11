import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
const previousDevMode = process.env.OPENWORK_DEV_MODE;
let tmpRoot = "";
const stops: Array<() => void | Promise<void>> = [];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openwork-dev-history-"));
  process.env.OPENWORK_RUNTIME_DB = join(tmpRoot, "runtime.sqlite");
  process.env.OPENWORK_DEV_MODE = "1";
});

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
  if (previousDevMode === undefined) delete process.env.OPENWORK_DEV_MODE;
  else process.env.OPENWORK_DEV_MODE = previousDevMode;
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = "";
  }
});

async function startDevServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_dev",
    hostToken: "owt_host",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_dev", name: "Dev", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}` };
}

async function json(response: Response) {
  expect(response.status).toBe(200);
  return response.json();
}

describe("dev history bridge", () => {
  test("save then list round-trip via HTTP", async () => {
    const root = join(tmpRoot, "ws");
    const { base } = await startDevServer(root);

    const save1 = await json(
      await fetch(`${base}/dev/history/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "ws_dev",
          filePath: "src/a.ts",
          content: "first",
          trigger: "manual",
        }),
      }),
    );
    expect(save1.deduped).toBe(false);
    expect(save1.trimmed).toBe(0);
    const id1 = save1.snapshot.id;

    const save2 = await json(
      await fetch(`${base}/dev/history/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "ws_dev",
          filePath: "src/a.ts",
          content: "first",
          trigger: "manual",
        }),
      }),
    );
    expect(save2.deduped).toBe(true);
    expect(save2.snapshot.id).toBe(id1);

    const list = await json(
      await fetch(`${base}/dev/history/list?workspaceId=ws_dev&filePath=${encodeURIComponent("src/a.ts")}`),
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0].content).toBe("first");
  });

  test("count returns total + per-file counts", async () => {
    const root = join(tmpRoot, "ws");
    const { base } = await startDevServer(root);
    // Each save has unique content to bypass the (workspace, file, hash) UNIQUE index.
    await fetch(`${base}/dev/history/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws_dev", filePath: "a.ts", content: "a-v1" }),
    });
    await fetch(`${base}/dev/history/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws_dev", filePath: "a.ts", content: "a-v2" }),
    });
    await fetch(`${base}/dev/history/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws_dev", filePath: "b.ts", content: "b-v1" }),
    });
    const all = await json(
      await fetch(`${base}/dev/history/count?workspaceId=ws_dev`),
    );
    expect(all.count).toBe(3);
    const a = await json(
      await fetch(`${base}/dev/history/count?workspaceId=ws_dev&filePath=a.ts`),
    );
    expect(a.count).toBe(2);
  });

  test("latest returns null for missing file", async () => {
    const root = join(tmpRoot, "ws");
    const { base } = await startDevServer(root);
    const out = await json(
      await fetch(`${base}/dev/history/latest?workspaceId=ws_dev&filePath=nope.ts`),
    );
    expect(out.snapshot).toBeNull();
  });

  test("delete removes a snapshot", async () => {
    const root = join(tmpRoot, "ws");
    const { base } = await startDevServer(root);
    const saved = await json(
      await fetch(`${base}/dev/history/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "ws_dev", filePath: "x.ts", content: "y" }),
      }),
    );
    const del = await json(
      await fetch(
        `${base}/dev/history/snapshot?workspaceId=ws_dev&snapshotId=${saved.snapshot.id}`,
        { method: "DELETE" },
      ),
    );
    expect(del.ok).toBe(true);
    const list = await json(
      await fetch(`${base}/dev/history/list?workspaceId=ws_dev&filePath=x.ts`),
    );
    expect(list.items).toHaveLength(0);
  });
});
