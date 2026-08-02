/**
 * Path resolution for the opencode-archive script.
 *
 * Archive root resolution (Phase 2):
 * - Per-workspace mode (preferred): `<workspace>/.opencode/archive/`. This
 *   keeps archive data with the project so it can be gitignored, backed
 *   up alongside the repo, and recovered when the workspace is cloned on
 *   a new machine. Multi-tenant safe: each workspace gets its own archive.
 * - Global mode (fallback): `$XDG_DATA_HOME/opencode-archive/`. Used when
 *   no workspace is supplied (test runs, ad-hoc CLI invocations).
 *
 * Override via `OPENCODE_ARCHIVE_ROOT` env var (global mode) or pass
 * `workspacePath` to `resolvePaths({ workspacePath })`.
 *
 * Other paths follow XDG Base Directory spec on Unix:
 * - $XDG_DATA_HOME/opencode-archive/ (default ~/.local/share/opencode-archive/)
 * - $XDG_CONFIG_HOME/opencode-archive/  (for state, default ~/.config/opencode-archive/)
 *
 * The opencode database location is also resolved here so callers don't have
 * to know the platform-specific macOS/Windows quirks.
 */

import { statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

function xdgDataHome(): string {
  const env = process.env.XDG_DATA_HOME?.trim();
  if (env) return env;
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"));
  }
  return join(homedir(), ".local/share");
}

function xdgConfigHome(): string {
  const env = process.env.XDG_CONFIG_HOME?.trim();
  if (env) return env;
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"));
  }
  return join(homedir(), ".config");
}

export type Paths = {
  /** Archive root, either per-workspace (`.opencode/archive/`) or XDG global. */
  archiveRoot: string;
  /** Scope label used in manifest for traceability. */
  scope: "workspace" | "global";
  /** Workspace path when `scope === "workspace"`. */
  workspacePath?: string;
  stateRoot: string;
  opencodeDb: string;
};

/**
 * Resolve the opencode database path. The OpenWork desktop app stores its
 * opencode data under `com.differentai.openwork.dev` on macOS, but the
 * standalone opencode binary uses `opencode/opencode.db` under $XDG_DATA_HOME.
 *
 * We probe both and prefer the OpenWork-managed one (the live system path).
 * Override with OPENCODE_DB env var for tests.
 */
export function resolveOpencodeDbPath(): string {
  const envOverride = process.env.OPENCODE_DB?.trim();
  if (envOverride) return envOverride;

  const candidates = [
    join(
      homedir(),
      "Library/Application Support/com.differentai.openwork.dev/openwork-dev-data/xdg/data/opencode/opencode.db",
    ),
    join(xdgDataHome(), "opencode/opencode.db"),
  ];
  for (const candidate of candidates) {
    if (tryStat(candidate)?.isFile()) return candidate;
  }
  // Fall back to the first candidate; the opencode-db layer will surface the
  // actual I/O error if the file is missing.
  return candidates[0] as string;
}

/**
 * Resolve the per-workspace archive root. The path is
 * `<workspace>/.opencode/archive/` — picked over a generic `.opencode-archive/`
 * to follow the same dotted-folder convention as `.vscode/`, `.idea/`,
 * `.opencode/`, and `.openwork/`.
 */
export function resolveWorkspaceArchiveRoot(workspacePath: string): string {
  return join(workspacePath, ".opencode", "archive");
}

export function resolvePaths(options?: { workspacePath?: string }): Paths {
  const stateRoot = join(xdgConfigHome(), "opencode-archive");
  if (options?.workspacePath) {
    return {
      archiveRoot: resolveWorkspaceArchiveRoot(options.workspacePath),
      scope: "workspace",
      workspacePath: options.workspacePath,
      stateRoot,
      opencodeDb: resolveOpencodeDbPath(),
    };
  }
  const archiveRoot =
    process.env.OPENCODE_ARCHIVE_ROOT?.trim() || join(xdgDataHome(), "opencode-archive");
  return {
    archiveRoot,
    scope: "global",
    stateRoot,
    opencodeDb: resolveOpencodeDbPath(),
  };
}

function tryStat(p: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}
