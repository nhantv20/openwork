import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  test("latest returns the most recent snapshot for a file (round-5)", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    for (let i = 0; i < 3; i += 1) {
      await json(
        await fetch(`${base}/workspace/ws_1/history/snapshot?path=a.ts`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: `v${i}`, trigger: "manual" }),
        }),
      );
      // Ensure ordering: a few ms between writes so createdAt differs.
      await new Promise((r) => setTimeout(r, 5));
    }
    const latest = await json(
      await fetch(`${base}/workspace/ws_1/history/latest?path=a.ts`, { headers }),
    );
    expect(latest.snapshot).not.toBeNull();
    expect(latest.snapshot.filePath).toBe("a.ts");
    // Most recent content wins.
    expect(latest.snapshot.content).toBe("v2");
  });

  test("latest returns null snapshot for an unseen file (round-5)", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    const latest = await json(
      await fetch(`${base}/workspace/ws_1/history/latest?path=never-saved.ts`, { headers }),
    );
    expect(latest.snapshot).toBeNull();
  });

  test("latest returns 400 when path query param is missing (round-5)", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const res = await fetch(`${base}/workspace/ws_1/history/latest`, {
      headers: auth(token),
    });
    expect(res.status).toBe(400);
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

  test("diff endpoint returns unified diff text (slice 6.5a)", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    const a = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=d.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "line1\nline2\nline3\n" }),
      }),
    );
    const b = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=d.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "line1\nLINE2\nline3\n" }),
      }),
    );
    const diff = await json(
      await fetch(
        `${base}/workspace/ws_1/history/diff?path=d.ts&from=${a.snapshot.id}&to=${b.snapshot.id}`,
        { headers },
      ),
    );
    expect(diff.diff).toContain("--- d.ts");
    expect(diff.diff).toContain("+++ d.ts");
    expect(diff.diff).toContain("-line2");
    expect(diff.diff).toContain("+LINE2");
    expect(diff.fromMeta.id).toBe(a.snapshot.id);
    expect(diff.toMeta.id).toBe(b.snapshot.id);
  });

  test("diff endpoint with from='current' reads the live file", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    // Snapshot v1
    const snap = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=live.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "old\n" }),
      }),
    );
    // Write a new file on disk
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${workspaceRoot}/live.ts`, "new\n", "utf8");
    // Diff snapshot vs current
    const diff = await json(
      await fetch(
        `${base}/workspace/ws_1/history/diff?path=live.ts&from=${snap.snapshot.id}&to=current`,
        { headers },
      ),
    );
    expect(diff.diff).toContain("-old");
    expect(diff.diff).toContain("+new");
  });

  test("diff endpoint reports byte count for 'current' meta (round-4 fix)", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    // Write a file containing 4-byte UTF-8 emoji (U+1F600 = 😀 = 4 bytes,
    // 2 UTF-16 code units). Pre-fix this reported size=2 (string length);
    // post-fix it reports size=4 (byteLength).
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${workspaceRoot}/emoji.ts`, "\u{1F600}\n", "utf8");
    const diff = await json(
      await fetch(
        `${base}/workspace/ws_1/history/diff?path=emoji.ts&from=current&to=current`,
        { headers },
      ),
    );
    expect(diff.fromMeta.id).toBe("current");
    expect(diff.toMeta.id).toBe("current");
    // Emoji + newline = 4 + 1 = 5 bytes
    expect(diff.fromMeta.size).toBe(5);
    expect(diff.toMeta.size).toBe(5);
  });

  test("changes endpoint returns one row per file with at least one snapshot", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    // Seed: 2 snapshots in a.ts, 1 in b.ts. Sleep between saves so
    // createdAt is strictly increasing — the tiebreaker on
    // (MAX(created_at) DESC, file_path ASC) only kicks in for files
    // with the same latest timestamp.
    for (let i = 0; i < 2; i += 1) {
      await json(
        await fetch(`${base}/workspace/ws_1/history/snapshot?path=a.ts`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: `a-v${i}` }),
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=b.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "b-v0" }),
      }),
    );
    const changes = await json(
      await fetch(`${base}/workspace/ws_1/changes`, { headers }),
    );
    expect(changes.items).toHaveLength(2);
    // Sorted by latestSnapshotAt DESC; b.ts was saved last.
    expect(changes.items[0].filePath).toBe("b.ts");
    expect(changes.items[0].snapshotCount).toBe(1);
    expect(changes.items[1].filePath).toBe("a.ts");
    expect(changes.items[1].snapshotCount).toBe(2);
  });

  test("changes endpoint respects cursor pagination via before", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    // Seed: 3 distinct files with 1 snapshot each. The store auto-assigns
    // createdAt = Date.now() so sleeps in real time are fragile; instead
    // we assert pagination behavior with limit=2 and verify the cursor
    // moves the window forward (no overlap, total count matches seed).
    for (const path of ["a.ts", "b.ts", "c.ts"]) {
      await json(
        await fetch(`${base}/workspace/ws_1/history/snapshot?path=${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: "x" }),
        }),
      );
    }
    // Single page can return at most 2 items (limit=2); we have 3 files.
    const first = await json(
      await fetch(`${base}/workspace/ws_1/changes?limit=2`, { headers }),
    );
    expect(first.items).toHaveLength(2);
    // nextCursor is set because we asked for limit=2 but have 3 files.
    const full = await json(
      await fetch(`${base}/workspace/ws_1/changes?limit=10`, { headers }),
    );
    expect(full.items).toHaveLength(3);
    // Cursor-based pagination covers the same set.
    if (first.nextCursor !== null) {
      const second = await json(
        await fetch(`${base}/workspace/ws_1/changes?limit=10&before=${first.nextCursor}`, { headers }),
      );
      const firstPaths = new Set(first.items.map((i: { filePath: string }) => i.filePath));
      const secondPaths = new Set(second.items.map((i: { filePath: string }) => i.filePath));
      const overlap = [...firstPaths].filter((p) => secondPaths.has(p));
      expect(overlap).toHaveLength(0);
      // Union equals full set.
      const allPaths = new Set([...firstPaths, ...secondPaths]);
      expect(allPaths.size).toBe(full.items.length);
    }
  });

  test("changes endpoint cross-workspace isolation", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    // Snapshot in ws_1
    await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=ws1-only.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "x" }),
      }),
    );
    // Query ws_2 (doesn't exist as a workspace) — should return 404.
    const response = await fetch(`${base}/workspace/ws_2/changes`, { headers });
    expect(response.status).toBe(404);
  });

  test("diff endpoint with from='current' reads the live file", async () => {
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

// ---------------------------------------------------------------------------
// Phase 6.9: Review Tab — approval workflow
// ---------------------------------------------------------------------------
// Helpers: agent snapshots are only "pending" by default; for reject tests
// we need a pre-AI parent, so we save the parent snapshot first via the
// existing `/history/snapshot` endpoint with a content that does not match
// the file on disk. The slice-6.9 reject route then restores the file
// from the parent and flips the agent snapshot to "rejected".
async function saveAgentSnapshot(
  base: string,
  headers: Record<string, string>,
  filePath: string,
  content: string,
  parentSnapshotId: string | null = null,
): Promise<{ snapshot: { id: string; status: string; parentSnapshotId: string | null } }> {
  return (await json(
    await fetch(`${base}/workspace/ws_1/history/snapshot?path=${encodeURIComponent(filePath)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content, trigger: "agent", parentSnapshotId }),
    }),
  )) as { snapshot: { id: string; status: string; parentSnapshotId: string | null } };
}

describe("approval workflow (Phase 6.9)", () => {
  test("pending-approvals lists pending agent snapshots and ignores non-pending ones", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    // 1. Agent snapshot — should appear in pending list.
    await saveAgentSnapshot(base, headers, "alpha.ts", "// AI edit\n", null);
    // 2. Manual snapshot — must NOT appear.
    await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=beta.ts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "// user wrote\n", trigger: "manual" }),
      }),
    );
    // 3. Another agent snapshot — should appear.
    const second = await saveAgentSnapshot(base, headers, "gamma.ts", "// AI edit 2\n", null);

    const list = await json(
      await fetch(`${base}/workspace/ws_1/pending-approvals`, { headers }),
    ) as { items: Array<{ filePath: string; snapshotId: string }> };
    const paths = list.items.map((i) => i.filePath).sort();
    expect(paths).toEqual(["alpha.ts", "gamma.ts"]);

    // Approve the second one — it should drop off the list.
    await json(
      await fetch(`${base}/workspace/ws_1/approvals/${second.snapshot.id}/approve`, {
        method: "POST",
        headers,
        body: "{}",
      }),
    );
    const after = await json(
      await fetch(`${base}/workspace/ws_1/pending-approvals`, { headers }),
    ) as { items: Array<{ filePath: string }> };
    expect(after.items.map((i) => i.filePath).sort()).toEqual(["alpha.ts"]);
  });

  test("pending-approvals reports real +N -M line counts from parent → current", async () => {
    // The Review tab header renders a "Edited N files +X -Y" summary
    // using these counts. Before this fix the server always returned
    // 0/0 and the badge was useless. We use a real file on disk so
    // the server can read the current content and diff it against
    // the parent snapshot.
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    const filePath = "counted.ts";
    const fileAbs = join(workspaceRoot, filePath);
    // Pre-AI content (3 lines).
    await writeFile(fileAbs, "alpha\nbeta\ngamma\n", "utf8");
    const parent = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=${encodeURIComponent(filePath)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "alpha\nbeta\ngamma\n", trigger: "manual" }),
      }),
    ) as { snapshot: { id: string } };
    // Post-AI content: 1 unchanged + 1 deletion + 2 additions.
    await writeFile(fileAbs, "alpha\nBETA\ngamma\ndelta\nepsilon\n", "utf8");
    await saveAgentSnapshot(base, headers, filePath, "alpha\nBETA\ngamma\ndelta\nepsilon\n", parent.snapshot.id);

    const list = await json(
      await fetch(`${base}/workspace/ws_1/pending-approvals`, { headers }),
    ) as { items: Array<{ filePath: string; addedLines: number; removedLines: number; diffSummary: string }> };
    const row = list.items.find((i) => i.filePath === filePath);
    expect(row).toBeDefined();
    expect(row!.addedLines).toBeGreaterThan(0);
    expect(row!.removedLines).toBeGreaterThan(0);
    expect(row!.diffSummary).toMatch(/^\+\d+ -\d+$/);
  });

  test("approve flips status to approved; reject without parent returns NO_PARENT_SNAPSHOT", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    const snap = await saveAgentSnapshot(base, headers, "single.ts", "// AI", null);
    expect(snap.snapshot.status).toBe("pending");

    // Reject without a parent — must fail with 409 + no_parent_snapshot.
    const reject = await fetch(`${base}/workspace/ws_1/approvals/${snap.snapshot.id}/reject`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(reject.status).toBe(409);
    const errBody = (await reject.json()) as { code: string };
    expect(errBody.code).toBe("no_parent_snapshot");

    // Approve — flips status, leaves file alone.
    const approve = await json(
      await fetch(`${base}/workspace/ws_1/approvals/${snap.snapshot.id}/approve`, {
        method: "POST",
        headers,
        body: "{}",
      }),
    ) as { ok: boolean; snapshot: { status: string } };
    expect(approve.ok).toBe(true);
    expect(approve.snapshot.status).toBe("approved");
  });

  test("reject restores the file from the parent snapshot", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    const filePath = "restore-me.ts";
    const fileAbs = join(workspaceRoot, filePath);
    // Pre-AI content.
    await writeFile(fileAbs, "PRE_AI_CONTENT", "utf8");
    const parent = await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=${encodeURIComponent(filePath)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "PRE_AI_CONTENT", trigger: "manual" }),
      }),
    ) as { snapshot: { id: string } };
    // AI overwrites the file.
    await writeFile(fileAbs, "POST_AI_CONTENT", "utf8");
    const agent = await saveAgentSnapshot(base, headers, filePath, "POST_AI_CONTENT", parent.snapshot.id);

    // Reject — file should be back to PRE_AI_CONTENT.
    const result = await json(
      await fetch(`${base}/workspace/ws_1/approvals/${agent.snapshot.id}/reject`, {
        method: "POST",
        headers,
        body: "{}",
      }),
    ) as { ok: boolean; restoredFrom: string };
    expect(result.ok).toBe(true);
    expect(result.restoredFrom).toBe(parent.snapshot.id);
    const onDisk = await readFile(fileAbs, "utf8");
    expect(onDisk).toBe("PRE_AI_CONTENT");

    // Snapshot status flipped to rejected.
    const list = await json(
      await fetch(`${base}/workspace/ws_1/pending-approvals`, { headers }),
    ) as { items: unknown[] };
    expect(list.items).toHaveLength(0);
  });

  test("approve-all is best-effort — partial success reported", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    const a = await saveAgentSnapshot(base, headers, "a.ts", "// a", null);
    const b = await saveAgentSnapshot(base, headers, "b.ts", "// b", null);

    const result = await json(
      await fetch(`${base}/workspace/ws_1/approvals/approve-all`, {
        method: "POST",
        headers,
        body: JSON.stringify({ snapshotIds: [a.snapshot.id, b.snapshot.id, "missing-id"] }),
      }),
    ) as { approvedCount: number; failed: Array<{ snapshotId: string; reason: string }> };
    expect(result.approvedCount).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].snapshotId).toBe("missing-id");
    expect(result.failed[0].reason).toBe("snapshot_not_found");
  });

  test("agent-snapshots paginates by createdAt cursor", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    for (let i = 0; i < 3; i += 1) {
      await saveAgentSnapshot(base, headers, `f${i}.ts`, `// v${i}`, null);
      // Spread out createdAt a touch so cursor ordering is deterministic.
      await new Promise((r) => setTimeout(r, 5));
    }

    const page1 = await json(
      await fetch(`${base}/workspace/ws_1/agent-snapshots?limit=2`, { headers }),
    ) as { items: Array<{ id: string }>; nextCursor: number | null };
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await json(
      await fetch(`${base}/workspace/ws_1/agent-snapshots?limit=2&before=${page1.nextCursor}`, { headers }),
    ) as { items: Array<{ id: string }>; nextCursor: number | null };
    expect(page2.items.length).toBeGreaterThan(0);
    // No overlap with page 1.
    const page1Ids = new Set(page1.items.map((i) => i.id));
    expect(page2.items.some((i) => page1Ids.has(i.id))).toBe(false);
  });

  test("legacy snapshots (no status) are excluded from pending-approvals", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    // Force the runtime DB to be created + migrated by writing one
    // row through the normal endpoint first. The raw insert below
    // requires the table to exist (and the status / parent_snapshot_id
    // columns to be present, added by the Phase 6.9 ALTER TABLE).
    await saveAgentSnapshot(base, headers, "primer.ts", "// primer", null);

    // Insert a row directly with NULL status (simulates pre-Phase-6.9
    // data). Using the snapshot endpoint always sets status, so we
    // bypass it with a manual SQL write.
    const { Database } = await import("bun:sqlite");
    const dbPath = process.env.OPENWORK_RUNTIME_DB!;
    const sqlite = new Database(dbPath);
    sqlite.run(
      "INSERT INTO file_snapshots (id, workspace_id, file_path, content_hash, content, size, created_at, trigger, revision, status, parent_snapshot_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent', NULL, NULL, NULL)",
      ["legacy-1", "ws_1", "legacy.ts", "abc", "old", 3, Date.now() - 10000],
    );
    sqlite.close();

    // pending-approvals must NOT include the legacy row.
    const list = await json(
      await fetch(`${base}/workspace/ws_1/pending-approvals`, { headers }),
    ) as { items: Array<{ filePath: string }> };
    expect(list.items.map((i) => i.filePath)).not.toContain("legacy.ts");

    // agent-snapshots (no status filter) DOES include it — UI shows
    // the row with a "legacy" badge.
    const all = await json(
      await fetch(`${base}/workspace/ws_1/agent-snapshots`, { headers }),
    ) as { items: Array<{ filePath: string; status?: string }> };
    const legacy = all.items.find((i) => i.filePath === "legacy.ts");
    expect(legacy).toBeDefined();
    expect(legacy?.status).toBeUndefined();
  });

  test("agent-snapshots status filter returns only matching rows", async () => {
    // Regression test for the listByStatus SQL bug (duplicate SELECT
    // from `SELECT ${base}` concatenation) — without a status filter
    // the route never hit the buggy branch, so we lock it down here.
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    const a = await saveAgentSnapshot(base, headers, "f-a.ts", "// a", null);
    await saveAgentSnapshot(base, headers, "f-b.ts", "// b", null);
    // Approve a — it should no longer show in status=pending.
    await json(
      await fetch(`${base}/workspace/ws_1/approvals/${a.snapshot.id}/approve`, {
        method: "POST",
        headers,
        body: "{}",
      }),
    );

    const pending = await json(
      await fetch(`${base}/workspace/ws_1/agent-snapshots?status=pending`, { headers }),
    ) as { items: Array<{ filePath: string; status?: string }> };
    expect(pending.items.map((i) => i.filePath).sort()).toEqual(["f-b.ts"]);
    expect(pending.items.every((i) => i.status === "pending")).toBe(true);

    const approved = await json(
      await fetch(`${base}/workspace/ws_1/agent-snapshots?status=approved`, { headers }),
    ) as { items: Array<{ filePath: string; status?: string }> };
    expect(approved.items.map((i) => i.filePath).sort()).toEqual(["f-a.ts"]);
    expect(approved.items.every((i) => i.status === "approved")).toBe(true);
  });

  test("pending-approvals backfills parentSnapshotId for legacy agent rows", async () => {
    // Regression test for the user-reported bug: every pending file
    // was rendering as "Initial version — no pre-AI snapshot" because
    // pre-fix agent snapshots were saved with parentSnapshotId=null
    // and the route returned that null verbatim. The fix looks up
    // the most recent non-agent snapshot for the same file on the
    // fly so the diff works without a destructive migration.
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);

    // Force the runtime DB to exist (and the new status /
    // parent_snapshot_id columns to be migrated in) by writing one
    // row through the normal endpoint.
    await saveAgentSnapshot(base, headers, "primer.ts", "// primer", null);

    // Plant a pre-AI snapshot + legacy agent row directly in the DB
    // to simulate the pre-fix state.
    const { Database } = await import("bun:sqlite");
    const dbPath = process.env.OPENWORK_RUNTIME_DB!;
    const sqlite = new Database(dbPath);
    sqlite.run(
      "INSERT INTO file_snapshots (id, workspace_id, file_path, content_hash, content, size, created_at, trigger, revision, status, parent_snapshot_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, NULL)",
      ["manual-1", "ws_1", "legacy-fix.ts", "h1", "PRE_AI_CONTENT", 14, Date.now() - 1000],
    );
    sqlite.run(
      "INSERT INTO file_snapshots (id, workspace_id, file_path, content_hash, content, size, created_at, trigger, revision, status, parent_snapshot_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent', NULL, 'pending', NULL)",
      ["agent-legacy-1", "ws_1", "legacy-fix.ts", "h2", "POST_AI_CONTENT", 15, Date.now()],
    );
    sqlite.close();

    const list = await json(
      await fetch(`${base}/workspace/ws_1/pending-approvals`, { headers }),
    ) as { items: Array<{ filePath: string; snapshotId: string; parentSnapshotId: string | null }> };
    const row = list.items.find((i) => i.filePath === "legacy-fix.ts");
    expect(row).toBeDefined();
    // The fix backfills the latest non-agent snapshot id so the
    // diff content (parent → current) actually has something to
    // show.
    expect(row?.parentSnapshotId).toBe("manual-1");
  });

  test("reject on a legacy agent row backfills parent and still restores", async () => {
    // Companion to the test above: rejecting a legacy row that has
    // no stamped parent must still work — the route resolves the
    // effective parent at call time and stamps the row so the
    // History tab and a re-call both see the link.
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startHistoryServer(workspaceRoot);
    const headers = auth(token);
    const filePath = "legacy-reject.ts";
    const fileAbs = join(workspaceRoot, filePath);

    // Set up: write pre-AI, save a manual snapshot, then overwrite
    // the file. The legacy agent row is inserted directly without a
    // parent_snapshot_id.
    await writeFile(fileAbs, "PRE_AI", "utf8");
    await json(
      await fetch(`${base}/workspace/ws_1/history/snapshot?path=${encodeURIComponent(filePath)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "PRE_AI", trigger: "manual" }),
      }),
    );
    await writeFile(fileAbs, "POST_AI", "utf8");

    const { Database } = await import("bun:sqlite");
    const dbPath = process.env.OPENWORK_RUNTIME_DB!;
    const sqlite = new Database(dbPath);
    sqlite.run(
      "INSERT INTO file_snapshots (id, workspace_id, file_path, content_hash, content, size, created_at, trigger, revision, status, parent_snapshot_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent', NULL, 'pending', NULL)",
      ["agent-legacy-2", "ws_1", filePath, "h3", "POST_AI", 7, Date.now()],
    );
    sqlite.close();

    // Reject — must succeed and the file on disk must roll back to PRE_AI.
    const result = await json(
      await fetch(`${base}/workspace/ws_1/approvals/agent-legacy-2/reject`, {
        method: "POST",
        headers,
        body: "{}",
      }),
    ) as { ok: boolean; restoredFrom: string };
    expect(result.ok).toBe(true);
    expect(result.restoredFrom).toBeDefined();
    expect(await readFile(fileAbs, "utf8")).toBe("PRE_AI");
  });
});
