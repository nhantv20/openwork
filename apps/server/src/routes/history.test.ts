import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

const previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
const previousDevMode = process.env.OPENWORK_DEV_MODE;
let tmpRoot = "";
const stops: Array<() => void | Promise<void>> = [];

beforeEach(() => {
  tmpRoot = "";
  process.env.OPENWORK_RUNTIME_DB = "";
  process.env.OPENWORK_DEV_MODE = "";
});

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
  if (previousDevMode === undefined) delete process.env.OPENWORK_DEV_MODE;
  else process.env.OPENWORK_DEV_MODE = previousDevMode;
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = "";
  }
});

async function setupWorkspace() {
  tmpRoot = await mkdtemp(join(tmpdir(), "openwork-history-"));
  const workspaceRoot = join(tmpRoot, "ws");
  await mkdir(workspaceRoot, { recursive: true });
  process.env.OPENWORK_RUNTIME_DB = join(tmpRoot, "runtime.sqlite");
  return workspaceRoot;
}

async function startHistoryServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test",
    hostToken: "owt_host",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "W", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
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
  return { base: `http://127.0.0.1:${server.port}`, token: config.token };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function json(response: Response, expectedStatus = 200) {
  expect(response.status).toBe(expectedStatus);
  return response.json();
}

describe("history API routes", () => {
  test("list returns snapshots ordered by createdAt desc with limit", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(`${base}/workspace/ws_1/history/snapshot?path=a.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: `v${i}`, trigger: "manual" }),
      });
      await json(r);
    }
    const list = await json(
      await fetch(`${base}/workspace/ws_1/history?path=a.ts&limit=2`, { headers }),
    );
    expect(list.items).toHaveLength(2);
    // Most recent first.
    expect(list.items[0].content).toBe("v2");
    expect(list.items[1].content).toBe("v1");
  });

  test("snapshot returns the saved row + deduped flag on second save", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    const first = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=a.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "same" }),
      }),
    );
    expect(first.deduped).toBe(false);
    expect(first.snapshot.content).toBe("same");

    const second = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=a.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "same" }),
      }),
    );
    expect(second.deduped).toBe(true);
    expect(second.snapshot.id).toBe(first.snapshot.id);
  });

  test("getContent returns the original content + hash + ts", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    const saved = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=a.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "hello" }),
      }),
    );
    const content = await json(
      await fetch(
        `${base}/workspace/ws_1/history/${saved.snapshot.id}/content?path=a.ts`,
        { headers },
      ),
    );
    expect(content.content).toBe("hello");
    expect(content.contentHash).toBe(saved.snapshot.contentHash);
    expect(content.createdAt).toBe(saved.snapshot.createdAt);
  });

  test("restore overwrites the file and creates an auto-snapshot of pre-restore state", async () => {
    const workspaceRoot = await setupWorkspace();
    const abs = join(workspaceRoot, "restored.ts");
    await writeFile(abs, "v2-current", "utf8");

    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    // Save snapshot of "v1" content manually.
    const snap = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=restored.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "v1-old", trigger: "manual" }),
      }),
    );
    // Overwrite file with "v2-current" so we have something to restore over.
    await writeFile(abs, "v2-current", "utf8");

    const restored = await json(
      await fetch(
        `${base}/workspace/ws_1/history/${snap.snapshot.id}/restore?path=restored.ts`,
        { method: "POST", headers, body: JSON.stringify({}) },
      ),
    );
    expect(restored.ok).toBe(true);
    expect(restored.snapshot.content).toBe("v1-old");

    // File on disk is now v1-old.
    const { readFile } = await import("node:fs/promises");
    const disk = await readFile(abs, "utf8");
    expect(disk).toBe("v1-old");

    // Two snapshots: the manual v1 + the auto-snapshot of v2-current.
    const list = await json(
      await fetch(`${base}/workspace/ws_1/history?path=restored.ts`, { headers }),
    );
    expect(list.items.length).toBeGreaterThanOrEqual(2);
  });

  test("404 for unknown snapshot id on content", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const response = await fetch(
      `${base}/workspace/ws_1/history/ghost-id/content?path=missing.ts`,
      { headers: auth(token) },
    );
    expect(response.status).toBe(404);
  });

  test("400 for missing path query param", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const response = await fetch(`${base}/workspace/ws_1/history`, {
      headers: auth(token),
    });
    expect(response.status).toBe(400);
  });

  test("diff endpoint returns 501 with metadata (slice 6.5a fills)", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    const a = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=d.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "a" }),
      }),
    );
    const b = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=d.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "b" }),
      }),
    );
    const diff = await json(
      await fetch(
        `${base}/workspace/ws_1/history/diff?path=d.ts&from=${a.snapshot.id}&to=${b.snapshot.id}`,
        { headers },
      ),
      501,
    );
    expect(diff.error).toBe("not_implemented");
    expect(diff.fromMeta.id).toBe(a.snapshot.id);
    expect(diff.toMeta.id).toBe(b.snapshot.id);
  });

  test("path with subdirs is accepted", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    const r = await json(
      await fetch(
        `${base}/workspace/ws_1/history/snapshot?path=${encodeURIComponent("src/components/Button.tsx")}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ content: "x" }),
        },
      ),
    );
    expect(r.snapshot.filePath).toBe("src/components/Button.tsx");
  });
});
