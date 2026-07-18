/**
 * Phase 6.6 — Git integration routes.
 *
 * Exposes 2 REST endpoints under `/workspace/:id/git/*`:
 *   1. GET /workspace/:id/git/status?path= — repo + per-file tracking
 *   2. GET /workspace/:id/git/diff?path=&from=&to= — raw `git diff` blob
 *
 * `path` is passed as a query param (not URL segment) to allow subdir
 * paths with `/` in them without URL-encoding. Matches the convention
 * in `routes/history.ts` (WBS round-3 review #14).
 */
import { ApiError } from "../errors.js";
import { unifiedDiff } from "../diff.js";
import {
  type GitRef,
  getCurrentBranch,
  getFileAtRef,
  getFileTrackedStatus,
  getGitRawDiff,
  getRepoGitStatus,
  GitRefNotFoundError,
  InvalidGitRefError,
  isCompatibleRefPair,
  isGitRepo,
  isValidRef,
  NotGitRepoError,
} from "../git-diff.js";
import { normalizeWorkspaceRelativePath } from "../server/normalize-path.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { addRoute, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;

export interface RegisterGitRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
}

function readPathFromQuery(url: URL): string {
  const value = url.searchParams.get("path");
  if (!value || !value.trim()) {
    throw new ApiError(400, "invalid_path", "Query param 'path' is required");
  }
  return normalizeWorkspaceRelativePath(value, { allowSubdirs: true });
}

function parseRef(value: string | null, field: "from" | "to"): GitRef {
  if (!value || !value.trim()) {
    throw new ApiError(400, "invalid_input", `Query param '${field}' is required`);
  }
  if (!isValidRef(value)) {
    throw new ApiError(400, "invalid_ref", `Invalid git ref: ${value}`, { field });
  }
  return value;
}

/** Map a thrown helper error onto the right HTTP code + body. */
function mapGitError(err: unknown): never {
  if (err instanceof NotGitRepoError) {
    throw new ApiError(404, "not_git_repo", err.message);
  }
  if (err instanceof InvalidGitRefError) {
    throw new ApiError(400, "invalid_ref", err.message, { ref: err.ref });
  }
  if (err instanceof GitRefNotFoundError) {
    throw new ApiError(404, "ref_not_found", err.message, { ref: err.ref });
  }
  throw err;
}

export function addGitRoutes(options: RegisterGitRoutesOptions): void {
  const { routes, config, jsonResponse, resolveWorkspace } = options;

  // 1. GET /workspace/:id/git/status?path=
  addRoute(routes, "GET", "/workspace/:id/git/status", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);

    // Status endpoint MUST NOT 404 when the workspace is not a git repo;
    // the UI uses `isGitRepo: false` to hide the Review tab.
    const isRepo = await isGitRepo(workspace.path);
    if (!isRepo) {
      return jsonResponse({
        isGitRepo: false,
        currentBranch: null,
        isTracked: false,
        isStaged: false,
        isModified: false,
        hasUncommittedChanges: false,
      });
    }

    const [branch, status] = await Promise.all([
      getCurrentBranch(workspace.path),
      getFileTrackedStatus(workspace.path, filePath),
    ]);

    return jsonResponse({
      isGitRepo: true,
      currentBranch: branch,
      isTracked: status.tracked,
      isStaged: status.staged,
      isModified: status.modified,
      hasUncommittedChanges: status.staged || status.modified,
    });
  });

  // 1b. GET /workspace/:id/git/repo-status — full repo status (all files)
  addRoute(routes, "GET", "/workspace/:id/git/repo-status", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const status = await getRepoGitStatus(workspace.path);
    if (!status) {
      return jsonResponse({ isGitRepo: false, branch: null, staged: [], modified: [], untracked: [] });
    }
    return jsonResponse({
      isGitRepo: true,
      branch: status.branch,
      staged: status.staged,
      modified: status.modified,
      untracked: status.untracked,
    });
  });

  // 2. GET /workspace/:id/git/diff?path=&from=&to=
  addRoute(routes, "GET", "/workspace/:id/git/diff", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const filePath = readPathFromQuery(ctx.url);
    const fromRef = parseRef(ctx.url.searchParams.get("from"), "from");
    const toRef = parseRef(ctx.url.searchParams.get("to"), "to");

    // Reject early when the workspace isn't a git repo — git itself
    // would return exit 128 mid-flight, which is hard to map to a
    // 404 cleanly. Calling isGitRepo first is cheap (1 fork/exec).
    if (!(await isGitRepo(workspace.path))) {
      throw new ApiError(404, "not_git_repo", `Not a git repository: ${workspace.path}`);
    }

    // Reject incompatible ref pairs (one symbolic + one SHA) before any
    // other check — this is a request-shape problem, not a workspace
    // problem, and the caller should fix it.
    if (!isCompatibleRefPair(fromRef, toRef)) {
      throw new ApiError(
        400,
        "invalid_ref_pair",
        `Cannot mix symbolic ref and commit SHA in one diff (from=${fromRef}, to=${toRef})`,
      );
    }

    // For symbolic refs, "git diff <ref> -- <untracked-file>" exits 128
    // with "invalid object". Handle the untracked case explicitly:
    // synthesize a "new file" diff if the working tree has content,
    // otherwise report no changes.
    const status = await getFileTrackedStatus(workspace.path, filePath);
    if (!status.tracked) {
      const working = await getFileAtRef(workspace.path, filePath, "WORKING");
      if (working.isBinary || !working.content) {
        return jsonResponse({
          diff: "",
          isBinary: working.isBinary,
          truncated: false,
          fromMeta: { ref: fromRef },
          toMeta: { ref: toRef },
          fileUntracked: true,
        });
      }
      // Synthesize a unified diff that adds every line of the file.
      // We do this manually (instead of running `git diff /dev/null`)
      // so the format is identical to the server's `unifiedDiff()`
      // helper, which the existing `DiffViewer` already parses.
      const synthetic = unifiedDiff("", working.content, {
        fileName: filePath,
        oldLabel: fromRef,
        newLabel: toRef,
      });
      return jsonResponse({
        diff: synthetic,
        isBinary: false,
        truncated: false,
        fromMeta: { ref: fromRef },
        toMeta: { ref: toRef },
        fileUntracked: true,
      });
    }

    // From here on, every unhandled git failure is an unexpected
    // server-side problem; let it bubble to the global error handler.
    let result;
    try {
      result = await getGitRawDiff(workspace.path, filePath, fromRef, toRef);
    } catch (err) {
      mapGitError(err);
    }

    return jsonResponse({
      diff: result.diff,
      isBinary: result.isBinary,
      truncated: result.truncated,
      binaryMessage: result.binaryMessage ?? null,
      fromMeta: { ref: fromRef },
      toMeta: { ref: toRef },
    });
  });
}
