/**
 * Workspace-relative path normalization.
 *
 * Extracted from `routes/files.ts` in slice 6.3 so the new `routes/history.ts`
 * can reuse the same logic. Paths come in from many surfaces (artifacts, tool
 * logs, the new history endpoints) and need a single normalization rule.
 *
 * Rules:
 *  - Strip leading slashes and `./`
 *  - Strip `workspaces/<id>/` and `workspace/<id>/` prefixes
 *  - Strip `workspace/<token>/` (token = ws_xxx, digits, or hex)
 *  - Reject empty, NUL bytes, `.`/`..` segments
 *  - Reject subdirs if `allowSubdirs: false` (used by inbox endpoints)
 */
import { ApiError } from "../errors.js";

export function normalizeWorkspaceRelativePath(
  input: string,
  options: { allowSubdirs: boolean },
): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  if (raw.includes("\u0000")) {
    throw new ApiError(400, "invalid_path", "Path contains null byte");
  }

  let normalized = raw.replace(/\\/g, "/");
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^workspaces\/[^/]+\//i, "");
  normalized = normalized.replace(/^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i, "");
  normalized = normalized.replace(/^workspace\//, "");
  normalized = normalized.replace(/^\/+/, "");

  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    throw new ApiError(400, "invalid_path", "Path is required");
  }
  if (!options.allowSubdirs && parts.length > 1) {
    throw new ApiError(400, "invalid_path", "Subdirectories are not allowed");
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new ApiError(400, "invalid_path", "Path traversal is not allowed");
    }
  }
  return parts.join("/");
}
