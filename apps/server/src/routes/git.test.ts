/**
 * Phase 6.6 — integration tests for the /git/* routes.
 *
 * Boots a real server (so route registration + auth + error mapping is
 * exercised) against a temp workspace, then drives the endpoints with
 * `fetch`. Each test initializes a real git repo in the workspace
 * because mocking `execFile` would also need to mock git's exit codes
 * and stderr formats.
 */
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

async function setupWorkspace({ initGit = true }: { initGit?: boolean } = {}) {
  tmpRoot = await mkdtemp(join(tmpdir(), "openwork-git-routes-"));
  const workspaceRoot = join(tmpRoot, "ws");
  await mkdir(workspaceRoot, { recursive: true });
  if (initGit) {
    const proc = Bun.spawn(["git", "init", "-q", "-b", "main", workspaceRoot], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    await run(workspaceRoot, ["config", "user.email", "t@x"]);
    await run(workspaceRoot, ["config", "user.name", "T"]);
  }
  process.env.OPENWORK_RUNTIME_DB = join(tmpRoot, "runtime.sqlite");
  return workspaceRoot;
}

async function run(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

async function startGitServer(workspaceRoot: string) {
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
  return { Authorization: `Bearer ${token}` };
}

async function getJson(response: Response, expectedStatus = 200) {
  expect(response.status).toBe(expectedStatus);
  return response.json();
}

// ---------------------------------------------------------------------------
// /git/status
// ---------------------------------------------------------------------------

describe("GET /workspace/:id/git/status", () => {
  test("returns isGitRepo=false for a non-git workspace", async () => {
    const workspaceRoot = await setupWorkspace({ initGit: false });
    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(`${base}/workspace/ws_1/git/status?path=foo.txt`, { headers: auth(token) });
    const body = await getJson(res);
    expect(body).toEqual({
      isGitRepo: false,
      currentBranch: null,
      isTracked: false,
      isStaged: false,
      isModified: false,
      hasUncommittedChanges: false,
    });
  });

  test("returns isGitRepo=true with branch for a git workspace", async () => {
    const workspaceRoot = await setupWorkspace();
    // Need at least one commit so `git rev-parse HEAD` resolves and
    // `getCurrentBranch` returns "main" (a fresh repo is on unborn HEAD).
    await writeFile(join(workspaceRoot, "init.txt"), "x", "utf8");
    await run(workspaceRoot, ["add", "init.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "init"]);
    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(`${base}/workspace/ws_1/git/status?path=foo.txt`, { headers: auth(token) });
    const body = await getJson(res);
    expect(body.isGitRepo).toBe(true);
    expect(body.currentBranch).toBe("main");
    expect(body.isTracked).toBe(false);
  });

  test("reports tracked + modified for an edited committed file", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "foo.txt"), "v1", "utf8");
    await run(workspaceRoot, ["add", "foo.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "first"]);
    await writeFile(join(workspaceRoot, "foo.txt"), "v2", "utf8");

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(`${base}/workspace/ws_1/git/status?path=foo.txt`, { headers: auth(token) });
    const body = await getJson(res);
    expect(body.isTracked).toBe(true);
    expect(body.isModified).toBe(true);
    expect(body.isStaged).toBe(false);
    expect(body.hasUncommittedChanges).toBe(true);
  });

  test("returns 400 when path is missing", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(`${base}/workspace/ws_1/git/status`, { headers: auth(token) });
    expect(res.status).toBe(400);
  });

  test("returns 401 without auth", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base } = await startGitServer(workspaceRoot);
    const res = await fetch(`${base}/workspace/ws_1/git/status?path=foo.txt`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /git/diff
// ---------------------------------------------------------------------------

describe("GET /workspace/:id/git/diff", () => {
  test("HEAD → WORKING shows uncommitted diff", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "foo.txt"), "line1\nline2\n", "utf8");
    await run(workspaceRoot, ["add", "foo.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "first"]);
    await writeFile(join(workspaceRoot, "foo.txt"), "line1\nline2-changed\n", "utf8");

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=foo.txt&from=HEAD&to=WORKING`,
      { headers: auth(token) },
    );
    const body = await getJson(res);
    expect(body.isBinary).toBe(false);
    expect(body.truncated).toBe(false);
    expect(body.diff).toContain("-line2");
    expect(body.diff).toContain("+line2-changed");
    expect(body.fromMeta).toEqual({ ref: "HEAD" });
    expect(body.toMeta).toEqual({ ref: "WORKING" });
  });

  test("HEAD → WORKING returns empty diff when nothing changed", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "foo.txt"), "v1", "utf8");
    await run(workspaceRoot, ["add", "foo.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "first"]);

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=foo.txt&from=HEAD&to=WORKING`,
      { headers: auth(token) },
    );
    const body = await getJson(res);
    expect(body.diff).toBe("");
  });

  test("HEAD → STAGED diffs index against HEAD", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "foo.txt"), "v1", "utf8");
    await run(workspaceRoot, ["add", "foo.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "first"]);
    await writeFile(join(workspaceRoot, "foo.txt"), "v2-staged", "utf8");
    await run(workspaceRoot, ["add", "foo.txt"]);

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=foo.txt&from=HEAD&to=STAGED`,
      { headers: auth(token) },
    );
    const body = await getJson(res);
    expect(body.diff).toContain("-v1");
    expect(body.diff).toContain("+v2-staged");
  });

  test("returns fileUntracked=true when file is not in the repo", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "untracked.txt"), "x", "utf8");

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=untracked.txt&from=HEAD&to=WORKING`,
      { headers: auth(token) },
    );
    const body = await getJson(res);
    expect(body.fileUntracked).toBe(true);
  });

  test("synthesizes a 'new file' diff for untracked files with content", async () => {
    const workspaceRoot = await setupWorkspace();
    // Init repo with one commit so HEAD is valid.
    await writeFile(join(workspaceRoot, "init.txt"), "init", "utf8");
    await run(workspaceRoot, ["add", "init.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "init"]);
    // Now create a new untracked file with real content.
    await writeFile(
      join(workspaceRoot, "fresh.txt"),
      "line one\nline two\nline three\n",
      "utf8",
    );

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=fresh.txt&from=HEAD&to=WORKING`,
      { headers: auth(token) },
    );
    const body = await getJson(res);
    expect(body.fileUntracked).toBe(true);
    // The synthetic diff should add every line of the file.
    expect(body.diff).toContain("+line one");
    expect(body.diff).toContain("+line two");
    expect(body.diff).toContain("+line three");
    expect(body.diff).toMatch(/^@@ /m);
  });

  test("returns empty diff for empty untracked file", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "init.txt"), "init", "utf8");
    await run(workspaceRoot, ["add", "init.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "init"]);
    await writeFile(join(workspaceRoot, "empty.txt"), "", "utf8");

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=empty.txt&from=HEAD&to=WORKING`,
      { headers: auth(token) },
    );
    const body = await getJson(res);
    expect(body.fileUntracked).toBe(true);
    expect(body.diff).toBe("");
  });

  test("returns not_git_repo 404 for non-git workspace", async () => {
    const workspaceRoot = await setupWorkspace({ initGit: false });
    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=foo.txt&from=HEAD&to=WORKING`,
      { headers: auth(token) },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_git_repo");
  });

  test("returns 400 for invalid ref", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=foo.txt&from=garbage&to=HEAD`,
      { headers: auth(token) },
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for mixed symbolic + SHA pair", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=foo.txt&from=HEAD&to=abcdef0`,
      { headers: auth(token) },
    );
    expect(res.status).toBe(400);
  });

  test("SHA → SHA diffs between two commits", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "foo.txt"), "v1", "utf8");
    await run(workspaceRoot, ["add", "foo.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "first"]);
    const first = (await run(workspaceRoot, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(workspaceRoot, "foo.txt"), "v2", "utf8");
    await run(workspaceRoot, ["add", "foo.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "second"]);
    const second = (await run(workspaceRoot, ["rev-parse", "HEAD"])).stdout.trim();

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=foo.txt&from=${first}&to=${second}`,
      { headers: auth(token) },
    );
    const body = await getJson(res);
    expect(body.diff).toContain("-v1");
    expect(body.diff).toContain("+v2");
  });

  test("returns ref_not_found 404 for missing SHA", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "foo.txt"), "v1", "utf8");
    await run(workspaceRoot, ["add", "foo.txt"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "first"]);

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=foo.txt&from=deadbee&to=cafef00`,
      { headers: auth(token) },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("ref_not_found");
  });

  test("flags binary file diff", async () => {
    const workspaceRoot = await setupWorkspace();
    await writeFile(join(workspaceRoot, "blob.bin"), "text placeholder", "utf8");
    await run(workspaceRoot, ["add", "blob.bin"]);
    await run(workspaceRoot, ["commit", "-q", "-m", "first"]);
    await writeFile(join(workspaceRoot, "blob.bin"), Buffer.from([0, 1, 2, 3, 4]));

    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?path=blob.bin&from=HEAD&to=WORKING`,
      { headers: auth(token) },
    );
    const body = await getJson(res);
    expect(body.isBinary).toBe(true);
    expect(body.diff).toBe("");
  });

  test("returns 400 when path is missing", async () => {
    const workspaceRoot = await setupWorkspace();
    const { base, token } = await startGitServer(workspaceRoot);
    const res = await fetch(
      `${base}/workspace/ws_1/git/diff?from=HEAD&to=WORKING`,
      { headers: auth(token) },
    );
    expect(res.status).toBe(400);
  });
});
