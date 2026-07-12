/**
 * Tests for the git-diff helper. We use a real tempdir + real `git init`
 * because mocking `execFile` would also need to mock git's exit codes,
 * stderr formats, and the way it splits ref + path. Real git is faster
 * to reason about and surfaces platform bugs (e.g. CRLF on Windows).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDiffArgs,
  getCurrentBranch,
  getFileAtRef,
  getFileTrackedStatus,
  getGitRawDiff,
  GitNotInstalledError,
  GitRefNotFoundError,
  InvalidGitRefError,
  isCompatibleRefPair,
  isSymbolicRef,
  isValidRef,
  MAX_GIT_DIFF_BYTES,
  NotGitRepoError,
  type GitRef,
  SYMBOLIC_REFS,
} from "./git-diff.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "openwork-git-diff-"));
  // Initialize a real repo with one commit so HEAD always resolves.
  await run("git", ["init", "-q", "-b", "main", workDir]);
  await run("git", ["-C", workDir, "config", "user.email", "test@example.com"]);
  await run("git", ["-C", workDir, "config", "user.name", "Test"]);
});

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

async function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

async function commitFile(name: string, content: string, message = "init"): Promise<void> {
  const path = join(workDir, name);
  await writeFile(path, content, "utf8");
  await run("git", ["-C", workDir, "add", name]);
  await run("git", ["-C", workDir, "commit", "-q", "-m", message]);
}

// ---------------------------------------------------------------------------
// Ref validation
// ---------------------------------------------------------------------------

describe("ref validation", () => {
  test("SYMBOLIC_REFS is exactly HEAD/STAGED/WORKING", () => {
    expect([...SYMBOLIC_REFS].sort()).toEqual(["HEAD", "STAGED", "WORKING"]);
  });

  test("isSymbolicRef matches SYMBOLIC_REFS", () => {
    expect(isSymbolicRef("HEAD")).toBe(true);
    expect(isSymbolicRef("STAGED")).toBe(true);
    expect(isSymbolicRef("WORKING")).toBe(true);
    expect(isSymbolicRef("main")).toBe(false);
    expect(isSymbolicRef("abc1234")).toBe(false);
    expect(isSymbolicRef("")).toBe(false);
  });

  test("isValidRef accepts symbolic refs and 7-40 char hex SHAs", () => {
    for (const r of SYMBOLIC_REFS) expect(isValidRef(r)).toBe(true);
    expect(isValidRef("abcdef0")).toBe(true);
    expect(isValidRef("ABCDEF0")).toBe(true);
    expect(isValidRef("0123456789abcdef0123456789abcdef01234567")).toBe(true);
    expect(isValidRef("abc")).toBe(false);
    expect(isValidRef("g".repeat(40))).toBe(false);
    expect(isValidRef("abc1234;rm -rf /")).toBe(false);
  });

  test("isCompatibleRefPair rejects mixing symbolic and SHA", () => {
    expect(isCompatibleRefPair("HEAD", "WORKING")).toBe(true);
    expect(isCompatibleRefPair("abcdef0", "1234567")).toBe(true);
    expect(isCompatibleRefPair("HEAD", "abcdef0")).toBe(false);
    expect(isCompatibleRefPair("abcdef0", "HEAD")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isGitRepo / getCurrentBranch
// ---------------------------------------------------------------------------

describe("isGitRepo", () => {
  test("returns true inside a git working tree", async () => {
    expect(await import("./git-diff.js").then((m) => m.isGitRepo(workDir))).toBe(true);
  });

  test("returns false outside a git working tree", async () => {
    const other = await mkdtemp(join(tmpdir(), "openwork-not-git-"));
    try {
      expect(await import("./git-diff.js").then((m) => m.isGitRepo(other))).toBe(false);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

describe("getCurrentBranch", () => {
  test("returns the branch name when on a branch", async () => {
    await commitFile("a.txt", "a");
    const branch = await getCurrentBranch(workDir);
    expect(branch).toBe("main");
  });

  test("returns null for a fresh repo with no commits", async () => {
    const branch = await getCurrentBranch(workDir);
    expect(branch).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFileAtRef
// ---------------------------------------------------------------------------

describe("getFileAtRef", () => {
  test("WORKING reads current file from disk", async () => {
    await commitFile("foo.txt", "v1");
    await writeFile(join(workDir, "foo.txt"), "v2", "utf8");

    const result = await getFileAtRef(workDir, "foo.txt", "WORKING");
    expect(result.ref).toBe("WORKING");
    expect(result.content).toBe("v2");
    expect(result.isBinary).toBe(false);
  });

  test("WORKING returns content=null for missing file", async () => {
    const result = await getFileAtRef(workDir, "missing.txt", "WORKING");
    expect(result.content).toBeNull();
    expect(result.size).toBeNull();
  });

  test("HEAD reads the committed version", async () => {
    await commitFile("foo.txt", "v1");
    await writeFile(join(workDir, "foo.txt"), "v2", "utf8");

    const result = await getFileAtRef(workDir, "foo.txt", "HEAD");
    expect(result.content).toBe("v1");
  });

  test("HEAD returns content=null for file not in HEAD", async () => {
    // Need a commit so HEAD resolves; the untracked file isn't part of it.
    await commitFile("init.txt", "init");
    await writeFile(join(workDir, "untracked.txt"), "x", "utf8");
    const result = await getFileAtRef(workDir, "untracked.txt", "HEAD");
    expect(result.content).toBeNull();
  });

  test("STAGED reads the index version after git add", async () => {
    await commitFile("foo.txt", "v1");
    await writeFile(join(workDir, "foo.txt"), "v2-staged", "utf8");
    await run("git", ["-C", workDir, "add", "foo.txt"]);

    const result = await getFileAtRef(workDir, "foo.txt", "STAGED");
    expect(result.content).toBe("v2-staged");
  });

  test("STAGED returns null when file is not in the index", async () => {
    await writeFile(join(workDir, "untracked.txt"), "x", "utf8");
    const result = await getFileAtRef(workDir, "untracked.txt", "STAGED");
    expect(result.content).toBeNull();
  });

  test("throws InvalidGitRefError for malformed ref", async () => {
    await commitFile("foo.txt", "v1");
    expect(getFileAtRef(workDir, "foo.txt", "garbage" as GitRef)).rejects.toBeInstanceOf(
      InvalidGitRefError,
    );
  });

  test("flags binary file", async () => {
    await commitFile("blob.bin", "plain text");
    // Overwrite with binary content on disk.
    await writeFile(join(workDir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const result = await getFileAtRef(workDir, "blob.bin", "WORKING");
    expect(result.isBinary).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getGitRawDiff
// ---------------------------------------------------------------------------

describe("getGitRawDiff", () => {
  test("HEAD → WORKING shows a diff when file has uncommitted changes", async () => {
    await commitFile("foo.txt", "line1\nline2\nline3\n");
    await writeFile(join(workDir, "foo.txt"), "line1\nline2-changed\nline3\n", "utf8");

    const result = await getGitRawDiff(workDir, "foo.txt", "HEAD", "WORKING");
    expect(result.isBinary).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.diff).toContain("-line2");
    expect(result.diff).toContain("+line2-changed");
    expect(result.diff).toMatch(/^diff --git/m);
  });

  test("HEAD → WORKING returns empty diff when working tree matches HEAD", async () => {
    await commitFile("foo.txt", "v1");

    const result = await getGitRawDiff(workDir, "foo.txt", "HEAD", "WORKING");
    expect(result.diff).toBe("");
    expect(result.isBinary).toBe(false);
  });

  test("HEAD → STAGED diffs index against HEAD", async () => {
    await commitFile("foo.txt", "v1");
    await writeFile(join(workDir, "foo.txt"), "v2-staged", "utf8");
    await run("git", ["-C", workDir, "add", "foo.txt"]);
    // Now modify the file again (working tree differs from index).
    await writeFile(join(workDir, "foo.txt"), "v2-staged-and-then-some", "utf8");

    const result = await getGitRawDiff(workDir, "foo.txt", "HEAD", "STAGED");
    expect(result.diff).toContain("-v1");
    expect(result.diff).toContain("+v2-staged");
  });

  test("STAGED → WORKING diffs working tree against index", async () => {
    await commitFile("foo.txt", "v1");
    await writeFile(join(workDir, "foo.txt"), "v2-staged", "utf8");
    await run("git", ["-C", workDir, "add", "foo.txt"]);
    await writeFile(join(workDir, "foo.txt"), "v2-staged-and-then-some", "utf8");

    const result = await getGitRawDiff(workDir, "foo.txt", "STAGED", "WORKING");
    expect(result.diff).toContain("-v2-staged");
    expect(result.diff).toContain("+v2-staged-and-then-some");
  });

  test("SHA → SHA diffs between two commits", async () => {
    await commitFile("foo.txt", "v1", "first");
    const first = (await run("git", ["-C", workDir, "rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(workDir, "foo.txt"), "v2", "utf8");
    await run("git", ["-C", workDir, "add", "foo.txt"]);
    await run("git", ["-C", workDir, "commit", "-q", "-m", "second"]);
    const second = (await run("git", ["-C", workDir, "rev-parse", "HEAD"])).stdout.trim();

    const result = await getGitRawDiff(workDir, "foo.txt", first, second);
    expect(result.diff).toContain("-v1");
    expect(result.diff).toContain("+v2");
  });

  test("throws GitRefNotFoundError for missing commit SHA", async () => {
    await commitFile("foo.txt", "v1");
    expect(
      getGitRawDiff(workDir, "foo.txt", "deadbeef", "0000000"),
    ).rejects.toBeInstanceOf(GitRefNotFoundError);
  });

  test("throws InvalidGitRefError for mixed symbolic + SHA pair", async () => {
    await commitFile("foo.txt", "v1");
    expect(
      getGitRawDiff(workDir, "foo.txt", "HEAD", "abcdef0"),
    ).rejects.toBeInstanceOf(InvalidGitRefError);
  });

  test("flags binary file diff", async () => {
    await commitFile("blob.bin", "text placeholder");
    await writeFile(join(workDir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const result = await getGitRawDiff(workDir, "blob.bin", "HEAD", "WORKING");
    expect(result.isBinary).toBe(true);
    expect(result.diff).toBe("");
  });

  test("truncates oversized diff output", async () => {
    // Generate a 1.2MB diff by replacing one big line.
    const big = "x".repeat(MAX_GIT_DIFF_BYTES);
    await commitFile("big.txt", "original");
    await writeFile(join(workDir, "big.txt"), big, "utf8");

    const result = await getGitRawDiff(workDir, "big.txt", "HEAD", "WORKING");
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.diff, "utf8")).toBeLessThanOrEqual(MAX_GIT_DIFF_BYTES);
  });
});

// ---------------------------------------------------------------------------
// getFileTrackedStatus
// ---------------------------------------------------------------------------

describe("getFileTrackedStatus", () => {
  test("tracked file with no changes", async () => {
    await commitFile("foo.txt", "v1");
    const status = await getFileTrackedStatus(workDir, "foo.txt");
    expect(status).toEqual({ tracked: true, staged: false, modified: false });
  });

  test("tracked file with staged changes", async () => {
    await commitFile("foo.txt", "v1");
    await writeFile(join(workDir, "foo.txt"), "v2", "utf8");
    await run("git", ["-C", workDir, "add", "foo.txt"]);
    const status = await getFileTrackedStatus(workDir, "foo.txt");
    expect(status).toEqual({ tracked: true, staged: true, modified: false });
  });

  test("tracked file with working-tree changes only", async () => {
    await commitFile("foo.txt", "v1");
    await writeFile(join(workDir, "foo.txt"), "v2", "utf8");
    const status = await getFileTrackedStatus(workDir, "foo.txt");
    expect(status).toEqual({ tracked: true, staged: false, modified: true });
  });

  test("untracked file", async () => {
    await writeFile(join(workDir, "new.txt"), "x", "utf8");
    const status = await getFileTrackedStatus(workDir, "new.txt");
    expect(status).toEqual({ tracked: false, staged: false, modified: false });
  });
});

// ---------------------------------------------------------------------------
// buildDiffArgs (pure helper)
// ---------------------------------------------------------------------------

describe("buildDiffArgs", () => {
  test("HEAD → STAGED uses --cached", () => {
    expect(buildDiffArgs("a.txt", "HEAD", "STAGED")).toEqual([
      "diff",
      "--no-color",
      "--cached",
      "HEAD",
      "--",
      "a.txt",
    ]);
  });

  test("HEAD → WORKING", () => {
    expect(buildDiffArgs("a.txt", "HEAD", "WORKING")).toEqual([
      "diff",
      "--no-color",
      "HEAD",
      "--",
      "a.txt",
    ]);
  });

  test("STAGED → WORKING", () => {
    expect(buildDiffArgs("a.txt", "STAGED", "WORKING")).toEqual([
      "diff",
      "--no-color",
      "--",
      "a.txt",
    ]);
  });

  test("SHA → SHA uses ..", () => {
    expect(buildDiffArgs("a.txt", "abc1234", "def5678")).toEqual([
      "diff",
      "--no-color",
      "abc1234..def5678",
      "--",
      "a.txt",
    ]);
  });

  test("throws on incompatible pair", () => {
    expect(() => buildDiffArgs("a.txt", "HEAD", "abc1234")).toThrow(InvalidGitRefError);
  });
});

// ---------------------------------------------------------------------------
// GitNotInstalledError
// ---------------------------------------------------------------------------
// Note: we can't reliably test ENOENT without manipulating the parent's
// PATH (which Bun does not isolate per-test). On a machine without git
// installed the runGit helper throws GitNotInstalledError; we trust the
// execFile error contract for that branch. Coverage of the path is
// implicit: every other test would fail without a working git binary.
