/**
 * Dev-only HTTP bridge for the History debug panel.
 *
 * Exposes a tiny HTTP surface (under `/dev/history/*`) that lets the in-app
 * `/_dev/history` React page drive `SnapshotStore` directly. Slice 6.3 will
 * replace this with the real `/workspace/:id/history/*` REST endpoints; for
 * slice 6.1 the dev panel just needs to prove the store works end-to-end.
 *
 * Safety: every route here refuses to register unless
 * `process.env.OPENWORK_DEV_MODE === "1"`. In production builds, none of these
 * paths resolve. Additionally, all routes set `auth: "none"` because they
 * only run in dev — the OPENWORK_DEV_MODE gate is the real auth.
 */
import { addRoute, type Route } from "../routes/registry.js";
import { SnapshotStore } from "../file-snapshots.js";
import { ApiError } from "../errors.js";
import type { FileSnapshotTrigger, ServerConfig } from "../types.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

export interface RegisterDevHistoryRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
}

function isDevMode(): boolean {
  return process.env.OPENWORK_DEV_MODE === "1";
}

function requireDevMode(): void {
  if (!isDevMode()) {
    throw new ApiError(404, "not_found", "Dev routes are disabled");
  }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(400, "invalid_input", `${field} must be a non-empty string`);
  }
  return value;
}

function asTrigger(value: unknown): FileSnapshotTrigger {
  return value === "manual" ? "manual" : "auto";
}

export function addDevHistoryRoutes(options: RegisterDevHistoryRoutesOptions): void {
  if (!isDevMode()) return;

  const { routes, config, jsonResponse, readJsonBody } = options;
  const store = new SnapshotStore(config);

  // POST /dev/history/snapshot — create a snapshot for a (workspace, file) pair.
  addRoute(routes, "POST", "/dev/history/snapshot", "none", async (ctx) => {
    requireDevMode();
    const body = await readJsonBody(ctx.request);
    const workspaceId = asString(body.workspaceId, "workspaceId");
    const filePath = asString(body.filePath, "filePath");
    const content = asString(body.content, "content");
    const trigger = asTrigger(body.trigger);

    const result = await store.save({ workspaceId, filePath, content, trigger });
    return jsonResponse({
      snapshot: result.snapshot,
      deduped: result.deduped,
      trimmed: result.trimmed,
    });
  });

  // GET /dev/history/list?workspaceId=&filePath=&limit= — list snapshots for one file.
  addRoute(routes, "GET", "/dev/history/list", "none", async (ctx) => {
    requireDevMode();
    const workspaceId = ctx.url.searchParams.get("workspaceId");
    const filePath = ctx.url.searchParams.get("filePath");
    if (!workspaceId || !filePath) {
      throw new ApiError(400, "invalid_input", "workspaceId and filePath query params are required");
    }
    const limitRaw = ctx.url.searchParams.get("limit");
    const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw))) : 50;
    const items = await store.list(workspaceId, filePath, { limit });
    return jsonResponse({ items });
  });

  // GET /dev/history/count?workspaceId=&filePath= — count snapshots (debug tile).
  addRoute(routes, "GET", "/dev/history/count", "none", async (ctx) => {
    requireDevMode();
    const workspaceId = ctx.url.searchParams.get("workspaceId");
    if (!workspaceId) {
      throw new ApiError(400, "invalid_input", "workspaceId query param is required");
    }
    const filePath = ctx.url.searchParams.get("filePath") ?? undefined;
    const count = await store.count(workspaceId, filePath);
    return jsonResponse({ count });
  });

  // GET /dev/history/latest?workspaceId=&filePath= — latest snapshot for a file.
  addRoute(routes, "GET", "/dev/history/latest", "none", async (ctx) => {
    requireDevMode();
    const workspaceId = ctx.url.searchParams.get("workspaceId");
    const filePath = ctx.url.searchParams.get("filePath");
    if (!workspaceId || !filePath) {
      throw new ApiError(400, "invalid_input", "workspaceId and filePath query params are required");
    }
    const snapshot = await store.findLatest(workspaceId, filePath);
    return jsonResponse({ snapshot });
  });

  // DELETE /dev/history/snapshot — delete a snapshot by id.
  addRoute(routes, "DELETE", "/dev/history/snapshot", "none", async (ctx) => {
    requireDevMode();
    const workspaceId = ctx.url.searchParams.get("workspaceId");
    const snapshotId = ctx.url.searchParams.get("snapshotId");
    if (!workspaceId || !snapshotId) {
      throw new ApiError(400, "invalid_input", "workspaceId and snapshotId query params are required");
    }
    const ok = await store.delete(workspaceId, snapshotId);
    return jsonResponse({ ok });
  });
}
