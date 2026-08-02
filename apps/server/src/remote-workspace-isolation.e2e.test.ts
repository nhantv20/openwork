/**
 * Remote (OpenWork-Den cloud) workspace session isolation.
 *
 * Mirrors `workspace-session-isolation.e2e.test.ts` but for the production
 * / cloud path: a remote workspace that talks to a shared OpenCode instance
 * (Den, the OpenWork cloud). The remote workspace has no local filesystem
 * path, so we must fall back to a tenant-stable identifier — the Den
 * `openworkWorkspaceId` — to scope the `GET /session` request. Without
 * that fallback the SDK never attaches `x-opencode-directory` and
 * OpenCode returns every tenant's sessions.
 *
 * Regression for: "workspace A sees workspace B's sessions in production".
 */

import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const stops: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Mock OpenCode shared by every remote workspace in the test. It behaves
 * like a real cloud OpenCode: every request lands on the same instance
 * and the instance only scopes by `?directory=...` (or the v2 equivalent).
 * If OpenWork forgets to pass that signal, the instance returns every
 * tenant's sessions — the bug this test guards against.
 */
function startMockSharedOpencode(input: { tenantAToken: string; tenantBToken: string }) {
  const requests: Array<{
    pathname: string;
    query: URLSearchParams;
    directoryHeader: string | null;
  }> = [];

  // Each session is tagged with the directory token that should be
  // passed to the OpenCode client. The fix in `resolveOpencodeDirectory`
  // derives that token from `openworkWorkspaceId` and prefixes it with
  // `remote::`, so the mock honours the same convention.
  const sessionPool = [
    { id: "ses_A1", title: "Acme chat 1", slug: "a-1", directory: input.tenantAToken, time: { created: 100, updated: 200 } },
    { id: "ses_A2", title: "Acme chat 2", slug: "a-2", directory: input.tenantAToken, time: { created: 110, updated: 210 } },
    { id: "ses_B1", title: "Contoso chat 1", slug: "b-1", directory: input.tenantBToken, time: { created: 120, updated: 220 } },
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
      });

      if (url.pathname === "/session") {
        const scope = url.searchParams.get("scope");
        const directory = url.searchParams.get("directory")
          ?? request.headers.get("x-opencode-directory");

        if (scope === "project" || directory) {
          const filtered = sessionPool.filter((session) => session.directory === directory);
          return Response.json(filtered);
        }
        // Unscoped → leak everything.
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
  remoteWorkspaces: Array<{
    id: string;
    name: string;
    openworkWorkspaceId: string;
    openworkHostUrl: string;
  }>;
  opencodeBaseUrl: string;
}) {
  // `isAuthorizedRoot` requires `path` to live under one of `authorizedRoots`.
  // For remote workspaces the production equivalent is to register them
  // with an explicit `directory` that the workspace resolver accepts. To
  // keep the test focused on the isolation fallback we pre-authorize
  // an arbitrary root and set each workspace's `path` to a unique value
  // inside it.
  const fakeRoot = "/var/lib/openwork/tenants";
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_remote_isolation_token",
    hostToken: "owt_remote_isolation_host",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: input.remoteWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: `${fakeRoot}/${workspace.openworkWorkspaceId}`,
      preset: "remote",
      workspaceType: "remote",
      remoteType: "openwork",
      openworkHostUrl: workspace.openworkHostUrl,
      // OpenWork-Den acts as a thin proxy in front of the real OpenCode
      // instance. In production the URL is set on the workspace when
      // it's registered; in this test the mock opencode listens on
      // the same port as the proxy.
      baseUrl: workspace.openworkHostUrl,
      // openworkWorkspaceId is what Den uses to identify the tenant's
      // workspace. We deliberately omit `directory` here so the test
      // verifies the fallback in `resolveOpencodeDirectory` /
      // `buildWorkspaceInfos` actually fires.
      openworkWorkspaceId: workspace.openworkWorkspaceId,
    })),
    authorizedRoots: [fakeRoot],
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

describe("remote workspace session isolation", () => {
  test(
    "remote workspaces sharing one opencode instance only see their own sessions",
    async () => {
      const mock = startMockSharedOpencode({
      // These tokens must match the ones `resolveOpencodeDirectory`
      // synthesises from each workspace's `openworkWorkspaceId`.
      tenantAToken: "remote::wrk_acme_123",
      tenantBToken: "remote::wrk_contoso_456",
    });

      // Register two remote workspaces, each with its own Den
      // `openworkWorkspaceId`. No `directory` is supplied — the test
      // verifies that the fallback in `resolveOpencodeDirectory`
      // turns the Den id into a stable directory token.
      const openwork = await startOpenworkServer({
        remoteWorkspaces: [
          {
            id: "rem_acme",
            name: "Acme",
            openworkWorkspaceId: "wrk_acme_123",
            openworkHostUrl: `http://127.0.0.1:${mock.server.port}`,
          },
          {
            id: "rem_contoso",
            name: "Contoso",
            openworkWorkspaceId: "wrk_contoso_456",
            openworkHostUrl: `http://127.0.0.1:${mock.server.port}`,
          },
        ],
        opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
      });

      const base = `http://127.0.0.1:${openwork.server.port}`;

      // Acme asks for its sessions — must only see Acme's.
      const listA = await fetch(`${base}/workspace/rem_acme/sessions?limit=50`, {
        headers: auth(openwork.token),
      });
      expect(listA.status).toBe(200);
      const bodyA = await listA.json();
      const idsA = bodyA.items.map((item: { id: string }) => item.id);
      expect(idsA).toContain("ses_A1");
      expect(idsA).toContain("ses_A2");
      expect(idsA).not.toContain("ses_B1");

      // Contoso asks for its sessions — must only see Contoso's.
      const listB = await fetch(`${base}/workspace/rem_contoso/sessions?limit=50`, {
        headers: auth(openwork.token),
      });
      expect(listB.status).toBe(200);
      const bodyB = await listB.json();
      const idsB = bodyB.items.map((item: { id: string }) => item.id);
      expect(idsB).toContain("ses_B1");
      expect(idsB).not.toContain("ses_A1");
      expect(idsB).not.toContain("ses_A2");

      // Sanity: at least one /session request must have carried a filter
      // signal. If neither header nor query parameter was set, the mock
      // would have returned every session and the assertions above would
      // fail. This guards against a future refactor that drops the
      // directory token from remote workspace requests.
      const sessionRequests = mock.requests.filter((r) => r.pathname === "/session");
      const hasFilter = sessionRequests.some(
        (r) => r.query.get("scope") === "project"
          || r.query.get("directory") !== null
          || r.directoryHeader !== null,
      );
      expect(hasFilter).toBe(true);
    },
  );
});
