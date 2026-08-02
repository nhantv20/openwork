/**
 * Workspace session isolation — the bug we're fixing.
 *
 * When OpenWork is configured with N workspaces (N >= 2) and they all
 * share a single OpenCode instance (or the same OpenCode server is
 * reachable from multiple workspaces), the server MUST tell OpenCode
 * to scope the session list to the requesting workspace. Otherwise,
 * `GET /session` returns every session across every workspace, and
 * users see chats from other workspaces in their sidebar.
 *
 * This test reproduces that bug end-to-end:
 *   1. Two workspaces A and B share a single mock OpenCode instance.
 *   2. The mock OpenCode returns ALL sessions regardless of which
 *      workspace asked.
 *   3. OpenWork's `listWorkspaceSessions` must call OpenCode in a
 *      way that filters the response to ONLY the requesting
 *      workspace's sessions.
 *
 * The test does NOT prescribe the exact mechanism (header vs query
 * param vs `scope: "project"`). It only checks the final outcome:
 * when workspace A asks for sessions, it gets only A's sessions;
 * when workspace B asks, it gets only B's sessions.
 *
 * Once this test passes, the bug is fixed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
  while (roots.length) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

async function createWorkspaceRoot(folderName: string) {
  const root = await mkdtemp(join(tmpdir(), "openwork-isolation-"));
  const workspaceRoot = join(root, folderName);
  await mkdir(join(workspaceRoot, ".opencode"), { recursive: true });
  roots.push(root);
  return workspaceRoot;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Mock OpenCode that returns ALL sessions in a single global pool.
 * The mock has no idea about workspaces — that's intentional, so the
 * test forces OpenWork to tell it which workspace is asking.
 *
 * Each session is tagged with a `directory` that matches the workspace
 * it was created in. When OpenWork scopes the request to a particular
 * directory, the mock returns only that workspace's sessions.
 * When OpenWork does NOT scope the request, the mock returns
 * everything — which is the bug we are guarding against.
 */
function startMockOpencode(input: { workspaceAPath: string; workspaceBPath: string }) {
  const requests: Array<{
    pathname: string;
    query: URLSearchParams;
    directoryHeader: string | null;
    workspaceHeader: string | null;
  }> = [];

  const sessionPool = [
    {
      id: "ses_A1",
      title: "Workspace A — chat 1",
      slug: "a-1",
      directory: input.workspaceAPath,
      time: { created: 100, updated: 200 },
    },
    {
      id: "ses_A2",
      title: "Workspace A — chat 2",
      slug: "a-2",
      directory: input.workspaceAPath,
      time: { created: 110, updated: 210 },
    },
    {
      id: "ses_B1",
      title: "Workspace B — chat 1",
      slug: "b-1",
      directory: input.workspaceBPath,
      time: { created: 120, updated: 220 },
    },
  ];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push({
        pathname: url.pathname,
        query: url.searchParams,
        directoryHeader: request.headers.get("x-opencode-directory"),
        workspaceHeader: request.headers.get("x-opencode-workspace"),
      });

      if (url.pathname === "/session") {
        // Real OpenCode uses these signals to scope the list to the
        // requesting project. Our mock honours the same signals so
        // the test mirrors real behaviour.
        const scope = url.searchParams.get("scope");
        const directory = url.searchParams.get("directory")
          ?? request.headers.get("x-opencode-directory");
        const workspace = url.searchParams.get("workspace");

        if (scope === "project" || directory || workspace) {
          const filtered = sessionPool.filter((session) => {
            if (directory && directory === session.directory) return true;
            if (workspace && workspace === session.directory.replace(/[^a-zA-Z0-9]+/g, "_")) return true;
            return false;
          });
          return Response.json(filtered);
        }

        // No scope signal — return everything. If OpenWork leaks
        // through to the caller in this case, the test fails.
        return Response.json(sessionPool);
      }

      if (url.pathname === "/session/status") {
        return Response.json({});
      }

      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return { server, requests };
}

async function startOpenworkServer(input: {
  workspaces: Array<{ id: string; name: string; path: string }>;
  opencodeBaseUrl: string;
}) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_isolation_token",
    hostToken: "owt_isolation_host",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: input.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      preset: "starter",
      workspaceType: "local",
      baseUrl: input.opencodeBaseUrl,
    })),
    authorizedRoots: input.workspaces.map((w) => w.path),
    readOnly: true,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };

  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { server, token: config.token };
}

describe("workspace session isolation", () => {
  test("workspace A only sees its own sessions; workspace B only sees its own", async () => {
    const workspaceARoot = await createWorkspaceRoot("workspace-a");
    const workspaceBRoot = await createWorkspaceRoot("workspace-b");
    const mock = startMockOpencode({
      workspaceAPath: workspaceARoot,
      workspaceBPath: workspaceBRoot,
    });

    const openwork = await startOpenworkServer({
      workspaces: [
        { id: "ws_a", name: "Workspace A", path: workspaceARoot },
        { id: "ws_b", name: "Workspace B", path: workspaceBRoot },
      ],
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const base = `http://127.0.0.1:${openwork.server.port}`;

    // Workspace A asks for its sessions.
    const listA = await fetch(`${base}/workspace/ws_a/sessions?limit=50`, {
      headers: auth(openwork.token),
    });
    expect(listA.status).toBe(200);
    const bodyA = await listA.json();
    const idsA = bodyA.items.map((item: { id: string }) => item.id);
    expect(idsA).toContain("ses_A1");
    expect(idsA).toContain("ses_A2");
    expect(idsA).not.toContain("ses_B1");

    // Workspace B asks for its sessions.
    const listB = await fetch(`${base}/workspace/ws_b/sessions?limit=50`, {
      headers: auth(openwork.token),
    });
    expect(listB.status).toBe(200);
    const bodyB = await listB.json();
    const idsB = bodyB.items.map((item: { id: string }) => item.id);
    expect(idsB).toContain("ses_B1");
    expect(idsB).not.toContain("ses_A1");
    expect(idsB).not.toContain("ses_A2");

    // Sanity: at least one request to /session must have carried a
    // filter signal (scope=project, directory, or workspace query/header).
    // Otherwise the mock would have returned every session and the
    // assertions above would fail.
    const sessionListRequests = mock.requests.filter((r) => r.pathname === "/session");
    const hasFilter = sessionListRequests.some(
      (r) => r.query.get("scope") === "project"
        || r.query.get("directory") !== null
        || r.query.get("workspace") !== null
        || r.directoryHeader !== null
        || r.workspaceHeader !== null,
    );
    expect(hasFilter).toBe(true);
  });
});
