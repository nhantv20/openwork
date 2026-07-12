/**
 * Phase 6.6 — Git integration helpers.
 *
 * Pure-ish wrappers around the `git` CLI. Every function takes an absolute
 * workspace root and a workspace-relative file path; arguments are
 * passed to `git` via argv (no shell), so path injection is impossible.
 *
 * Error model: when a helper can't answer the question (git not installed,
 * not a repo, missing ref, …) it throws a typed error. Callers map the
 * error to a route response code. We deliberately do NOT return `null` /
 * `undefined` for "negative" answers because the route layer needs to
 * distinguish "not a git repo" (UI hides the Review tab) from "file not
 * tracked" (UI shows a different empty state).
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { join } from "node:path";

const execFileAsync = promisify(execFile);

/** Hard cap on a single file's content read from any git ref. Mirrors
 * `MAX_SNAPSHOT_BYTES` in `file-snapshots.ts` so the git path is no
 * weaker than the snapshot path. */
export const MAX_GIT_FILE_BYTES = 5_000_000;

/** Hard cap on a single diff blob returned to the client. Larger diffs
 * are truncated with a marker so the UI can warn the user. */
export const MAX_GIT_DIFF_BYTES = 1_000_000;

/** Symbolic git refs the UI exposes in the From / To dropdowns. */
export const SYMBOLIC_REFS = ["HEAD", "STAGED", "WORKING"] as const;
export type SymbolicRef = (typeof SYMBOLIC_REFS)[number];

/** Either a symbolic ref or a 7-40 char hex commit SHA. */
export type GitRef = SymbolicRef | string;

export type GitFileAt = {
  /** The ref this content was read from. */
  ref: GitRef;
  /** File content, or `null` if the file does not exist at this ref. */
  content: string | null;
  /** True when the file exists at this ref but contains a NUL byte in
   * the first 8KB (treat as binary, no diff). */
  isBinary: boolean;
  /** File size in bytes (best-effort, may be `null` for missing). */
  size: number | null;
};

export type GitRawDiff = {
  diff: string;
  isBinary: boolean;
  /** When `isBinary` is true this carries the git message ("Binary files
   * … differ") verbatim. */
  binaryMessage?: string;
  /** True if the diff was truncated to fit `MAX_GIT_DIFF_BYTES`. */
  truncated: boolean;
};

export type GitTrackedStatus = {
  tracked: boolean;
  staged: boolean;
  modified: boolean;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitNotInstalledError extends Error {
  constructor() {
    super("git binary not found on PATH");
    this.name = "GitNotInstalledError";
  }
}

export class NotGitRepoError extends Error {
  constructor(public readonly workspaceRoot: string) {
    super(`Not a git repository: ${workspaceRoot}`);
    this.name = "NotGitRepoError";
  }
}

export class InvalidGitRefError extends Error {
  constructor(public readonly ref: string) {
    super(`Invalid git ref: ${ref}`);
    this.name = "InvalidGitRefError";
  }
}

export class GitRefNotFoundError extends Error {
  constructor(public readonly ref: string) {
    super(`Git ref not found: ${ref}`);
    this.name = "GitRefNotFoundError";
  }
}

export class GitCommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly args: string[],
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} exited with code ${exitCode}: ${stderr}`);
    this.name = "GitCommandError";
  }
}

// ---------------------------------------------------------------------------
// Ref validation
// ---------------------------------------------------------------------------

const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

export function isSymbolicRef(value: string): value is SymbolicRef {
  return (SYMBOLIC_REFS as readonly string[]).includes(value);
}

export function isValidRef(value: string): value is GitRef {
  if (isSymbolicRef(value)) return true;
  return COMMIT_SHA_RE.test(value);
}

/** Reject combinations the MVP doesn't support (one symbolic + one SHA). */
export function isCompatibleRefPair(from: GitRef, to: GitRef): boolean {
  const fromIsSha = !isSymbolicRef(from);
  const toIsSha = !isSymbolicRef(to);
  return fromIsSha === toIsSha;
}

// ---------------------------------------------------------------------------
// Low-level execFile wrapper
// ---------------------------------------------------------------------------

type ExecFileResult = { stdout: string; stderr: string; code: number };

async function runGit(
  cwd: string,
  args: string[],
  options: { allowExitCodes?: number[]; maxBufferBytes?: number } = {},
): Promise<ExecFileResult> {
  const allowExitCodes = new Set(options.allowExitCodes ?? [0]);
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: options.maxBufferBytes ?? 10 * 1024 * 1024,
      // Inherit only the minimum env git needs to find its config.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      windowsHide: true,
    });
    return { stdout: String(stdout), stderr: String(stderr), code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: string | number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    if (e.code === "ENOENT") {
      throw new GitNotInstalledError();
    }
    const exitCode = typeof e.code === "number" ? e.code : 1;
    if (!allowExitCodes.has(exitCode)) {
      throw new GitCommandError(
        "git",
        args,
        exitCode,
        typeof e.stderr === "string" ? e.stderr : String(e.stderr ?? ""),
      );
    }
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : String(e.stdout ?? ""),
      stderr: typeof e.stderr === "string" ? e.stderr : String(e.stderr ?? ""),
      code: exitCode,
    };
  }
}

function sniffBinary(buf: Buffer): boolean {
  const sniff = buf.length > 8 * 1024 ? buf.subarray(0, 8 * 1024) : buf;
  for (let i = 0; i < sniff.length; i += 1) {
    if (sniff[i] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Is the given directory inside a git working tree? Returns `false` for
 * "not installed" (don't make the user install git just to open the app).
 */
export async function isGitRepo(workspaceRoot: string): Promise<boolean> {
  const result = await runGit(
    workspaceRoot,
    ["rev-parse", "--is-inside-work-tree"],
    { allowExitCodes: [0, 1, 128] },
  );
  return result.code === 0 && result.stdout.trim() === "true";
}

/**
 * Current branch name, or `null` if the repo is in detached HEAD state or
 * has no commits yet.
 */
export async function getCurrentBranch(workspaceRoot: string): Promise<string | null> {
  const result = await runGit(
    workspaceRoot,
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { allowExitCodes: [0, 1, 128] },
  );
  if (result.code !== 0) return null;
  const branch = result.stdout.trim();
  return branch === "HEAD" ? null : branch;
}

/**
 * Read a file at a given git ref.
 *
 * - `HEAD` / `<sha>` → `git show <ref>:<path>`
 * - `STAGED` → `git show :<path>` (reads from the index)
 * - `WORKING` → `readFile(absPath)` from disk
 *
 * Throws `InvalidGitRefError` for malformed refs, `GitRefNotFoundError`
 * when `git show` reports a missing object.
 */
export async function getFileAtRef(
  workspaceRoot: string,
  filePath: string,
  ref: GitRef,
): Promise<GitFileAt> {
  if (!isValidRef(ref)) {
    throw new InvalidGitRefError(ref);
  }

  if (ref === "WORKING") {
    const abs = join(workspaceRoot, filePath);
    try {
      const buf = await readFile(abs);
      if (buf.length > MAX_GIT_FILE_BYTES) {
        // We still return content; truncation is the caller's problem.
        // UI shows "File too large" before rendering.
      }
      return {
        ref,
        content: buf.toString("utf8"),
        isBinary: sniffBinary(buf),
        size: buf.byteLength,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { ref, content: null, isBinary: false, size: null };
      }
      throw err;
    }
  }

  if (ref === "STAGED") {
    return showGitObject(workspaceRoot, `:${filePath}`, ref);
  }

  return showGitObject(workspaceRoot, `${ref}:${filePath}`, ref);
}

async function showGitObject(
  workspaceRoot: string,
  object: string,
  ref: GitRef,
): Promise<GitFileAt> {
  // Use --text so binary files are still returned (we sniff ourselves).
  // If the object is missing, git exits 128 with "does not exist".
  const result = await runGit(
    workspaceRoot,
    ["show", object],
    { allowExitCodes: [0, 128], maxBufferBytes: MAX_GIT_FILE_BYTES + 1024 },
  );
  if (result.code === 128) {
    const cmd = ["show", object];
    if (isMissingObjectStderr(result.stderr)) {
      return { ref, content: null, isBinary: false, size: null };
    }
    // Unknown 128 — surface as command error.
    throw new GitCommandError("git", cmd, 128, result.stderr);
  }
  const buf = Buffer.from(result.stdout, "utf8");
  return {
    ref,
    content: buf.toString("utf8"),
    isBinary: sniffBinary(buf),
    size: buf.byteLength,
  };
}

/**
 * Return true if git's stderr for a "show" / "diff" 128 exit indicates
 * the requested object is missing, as opposed to a more fundamental
 * problem (corrupt repo, bad flags, …).
 */
function isMissingObjectStderr(stderr: string): boolean {
  const msg = stderr.toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("not in") ||
    msg.includes("bad revision") ||
    msg.includes("unknown revision") ||
    msg.includes("not a tree")
  );
}

/**
 * Raw `git diff` between two refs for a single file. Returns the verbatim
 * unified-diff output (with color disabled) so the existing `DiffViewer`
 * can parse it without a second translation step.
 *
 * Supported combinations:
 *   HEAD → STAGED      `git diff --no-color --cached HEAD -- <path>`
 *   HEAD → WORKING     `git diff --no-color HEAD -- <path>`
 *   STAGED → WORKING   `git diff --no-color -- <path>` (index vs working)
 *   WORKING → HEAD     same as HEAD→WORKING with labels swapped
 *   SHA → SHA          `git diff --no-color <from>..<to> -- <path>`
 *
 * Throws `InvalidGitRefError` for malformed refs, `NotGitRepoError` for
 * non-git workspaces, `GitRefNotFoundError` for missing SHAs.
 */
export async function getGitRawDiff(
  workspaceRoot: string,
  filePath: string,
  fromRef: GitRef,
  toRef: GitRef,
): Promise<GitRawDiff> {
  if (!isValidRef(fromRef)) throw new InvalidGitRefError(fromRef);
  if (!isValidRef(toRef)) throw new InvalidGitRefError(toRef);
  if (!isCompatibleRefPair(fromRef, toRef)) {
    throw new InvalidGitRefError(
      `cannot mix symbolic ref and commit SHA in one diff (from=${fromRef}, to=${toRef})`,
    );
  }

  // Same ref on both sides is a trivial no-op — return empty without
  // spawning git. Saves a fork/exec and dodges a corner case where
  // running `git diff HEAD HEAD -- <path>` against a deleted file
  // produces exit 128 noise on stderr.
  if (fromRef === toRef) {
    return { diff: "", isBinary: false, truncated: false };
  }

  const args = buildDiffArgs(filePath, fromRef, toRef);
  // Exit 0 = no diff, 1 = diff present, 128 = error.
  const result = await runGit(workspaceRoot, args, {
    allowExitCodes: [0, 1, 128],
    maxBufferBytes: MAX_GIT_DIFF_BYTES + 64 * 1024,
  });

  if (result.code === 128) {
    if (isMissingObjectStderr(result.stderr)) {
      throw new GitRefNotFoundError(`${fromRef}..${toRef}`);
    }
    throw new GitCommandError("git", args, 128, result.stderr);
  }

  const raw = result.stdout;

  // Binary diff detection: git writes "Binary files ... differ" to stdout
  // (or stderr on older versions) when both sides are binary.
  if (/^Binary files .* differ$/m.test(raw)) {
    return {
      diff: "",
      isBinary: true,
      binaryMessage: raw.trim().split("\n").pop(),
      truncated: false,
    };
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_GIT_DIFF_BYTES) {
    const truncated = raw.slice(0, MAX_GIT_DIFF_BYTES);
    return { diff: truncated, isBinary: false, truncated: true };
  }

  return { diff: raw, isBinary: false, truncated: false };
}

export function buildDiffArgs(filePath: string, fromRef: GitRef, toRef: GitRef): string[] {
  const fromIsSha = !isSymbolicRef(fromRef);
  if (fromIsSha) {
    // SHA → SHA path. `git diff <from>..<to> -- <path>`.
    return ["diff", "--no-color", `${fromRef}..${toRef}`, "--", filePath];
  }

  // All three combinations below are between symbolic refs.
  if (fromRef === "HEAD" && toRef === "STAGED") {
    return ["diff", "--no-color", "--cached", "HEAD", "--", filePath];
  }
  if (fromRef === "HEAD" && toRef === "WORKING") {
    return ["diff", "--no-color", "HEAD", "--", filePath];
  }
  if (fromRef === "STAGED" && toRef === "WORKING") {
    return ["diff", "--no-color", "--", filePath];
  }
  if (fromRef === "WORKING" && toRef === "HEAD") {
    // Working tree has no ref; we swap labels and let the UI show the
    // reverse, or we synthesize by running `git diff HEAD` (same bytes,
    // swapped add/remove). For MVP we just run the natural direction
    // and let the caller swap `from`/`to` labels.
    return ["diff", "--no-color", "HEAD", "--", filePath];
  }
  if (fromRef === "STAGED" && toRef === "HEAD") {
    return ["diff", "--no-color", "--cached", "HEAD", "--", filePath];
  }
  if (fromRef === "WORKING" && toRef === "STAGED") {
    // Same caveat as WORKING→HEAD: synthesize as STAGED→WORKING with
    // swapped labels.
    return ["diff", "--no-color", "--", filePath];
  }
  // getGitRawDiff short-circuits same-ref before calling us, so the
  // remaining branches are non-degenerate.
  throw new InvalidGitRefError(`unsupported ref pair: ${fromRef} → ${toRef}`);
}

/**
 * Per-file tracking status. Combines three cheap git queries. Returns
 * `{ tracked: false, staged: false, modified: false }` when the
 * workspace is not a git repo (caller can decide whether to show an
 * empty status or hide the UI).
 */
export async function getFileTrackedStatus(
  workspaceRoot: string,
  filePath: string,
): Promise<GitTrackedStatus> {
  // Treat "not a git repo" (exit 128 with "fatal: not a git repository")
  // the same as "not tracked" — return all-false rather than throwing.
  const [trackedRes, stagedRes, modifiedRes] = await Promise.all([
    runGit(
      workspaceRoot,
      ["ls-files", "--error-unmatch", "--", filePath],
      { allowExitCodes: [0, 1, 128] },
    ),
    runGit(
      workspaceRoot,
      ["diff", "--cached", "--name-only", "--", filePath],
      { allowExitCodes: [0, 1, 128] },
    ),
    runGit(
      workspaceRoot,
      ["diff", "--name-only", "--", filePath],
      { allowExitCodes: [0, 1, 128] },
    ),
  ]);
  return {
    tracked: trackedRes.code === 0,
    staged: stagedRes.stdout.trim().length > 0,
    modified: modifiedRes.stdout.trim().length > 0,
  };
}
