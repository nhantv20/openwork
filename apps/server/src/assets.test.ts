import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  upsertAsset,
  getAsset,
  getAssetVersions,
  listAssets,
  resolveAsset,
  deleteAsset,
  diffAsset,
} from "./assets.js";
import { ApiError } from "./errors.js";

let workspace: string;
let storageRoot: string;

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), "openwork-assets-"));
  storageRoot = mkdtempSync(join(tmpdir(), "openwork-assets-cache-"));
  process.env.HOME = storageRoot;
  process.env.USERPROFILE = storageRoot;
  mkdirSync(join(storageRoot, ".config", "openwork", "assets-cache", "hub"), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(storageRoot, { recursive: true, force: true });
});

describe("assets.upsertAsset", () => {
  test("creates a text asset with auto-bumped version", async () => {
    const manifest = await upsertAsset(workspace, {
      id: "acme/letterhead",
      name: "Acme Letterhead",
      kind: "text",
      content: "# Letterhead\n\nAcme Inc.",
      tags: ["brand", "docx"],
      createdBy: "user:tester",
    });
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.kind).toBe("text");
    expect(manifest.checksum.startsWith("sha256:")).toBe(true);
    expect(manifest.files).toBeUndefined();
    expect(manifest.tags).toEqual(["brand", "docx"]);
  });

  test("bumps patch version on subsequent text asset", async () => {
    const first = await upsertAsset(workspace, {
      id: "acme/letterhead",
      kind: "text",
      content: "v1",
    });
    const second = await upsertAsset(workspace, {
      id: "acme/letterhead",
      kind: "text",
      content: "v2",
    });
    expect(second.version).not.toBe(first.version);
    expect(["1.0.1"]).toContain(second.version);
  });

  test("creates a bundle with multiple files", async () => {
    const manifest = await upsertAsset(workspace, {
      id: "acme/brand-kit",
      kind: "bundle",
      files: {
        "shell.docx": "base64:UEsDBBQAAAAI",
        "colors.json": '{"primary":"#1A2B3C"}',
      },
      createdBy: "user:tester",
    });
    expect(manifest.kind).toBe("bundle");
    expect(manifest.files).toHaveLength(2);
    expect(manifest.size).toBeGreaterThan(0);
  });

  test("rejects duplicate version", async () => {
    await upsertAsset(workspace, { id: "x/y", kind: "text", content: "a", version: "1.0.0" });
    await expect(
      upsertAsset(workspace, { id: "x/y", kind: "text", content: "b", version: "1.0.0" }),
    ).rejects.toThrow(ApiError);
  });

  test("rejects invalid id", async () => {
    await expect(
      upsertAsset(workspace, { id: "Bad Id With Spaces", kind: "text", content: "x" }),
    ).rejects.toThrow(ApiError);
  });

  test("rejects oversized bundle", async () => {
    const big = "x".repeat(1024);
    await expect(
      upsertAsset(workspace, {
        id: "big/one",
        kind: "bundle",
        files: { "a.txt": big, "b.txt": big, "c.txt": big },
      }, { bundleMaxBytes: 2000 }),
    ).rejects.toThrow(/exceeds/);
  });

  test("rejects reserved bundle filenames", async () => {
    await expect(
      upsertAsset(workspace, {
        id: "x/y",
        kind: "bundle",
        files: { "manifest.json": "evil" },
      }),
    ).rejects.toThrow(/Reserved/);
  });
});

describe("assets.getAsset", () => {
  test("returns latest version when version omitted", async () => {
    await upsertAsset(workspace, { id: "x/y", kind: "text", content: "a", version: "1.0.0" });
    await upsertAsset(workspace, { id: "x/y", kind: "text", content: "b", version: "2.0.0" });
    const m = await getAsset(workspace, "workspace", "x/y");
    expect(m.version).toBe("2.0.0");
  });

  test("resolves semver-loose match (@2 -> 2.x.x)", async () => {
    await upsertAsset(workspace, { id: "x/y", kind: "text", content: "a", version: "2.0.0" });
    await upsertAsset(workspace, { id: "x/y", kind: "text", content: "b", version: "2.5.3" });
    const m = await getAsset(workspace, "workspace", "x/y", "2");
    expect(m.version).toBe("2.5.3");
  });

  test("returns 404 for missing asset", async () => {
    await expect(getAsset(workspace, "workspace", "nope/missing")).rejects.toMatchObject({
      code: "asset_not_found",
    });
  });
});

describe("assets.listAssets", () => {
  test("lists workspace and local scopes, filtered by tag", async () => {
    await upsertAsset(workspace, { id: "acme/a", kind: "text", content: "a", tags: ["brand"] });
    await upsertAsset(workspace, { id: "acme/b", kind: "text", content: "b", tags: ["other"] });
    const all = await listAssets(workspace);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const brand = await listAssets(workspace, { tag: "brand" });
    expect(brand.length).toBe(1);
    expect(brand[0].id).toBe("acme/a");
  });

  test("filters by kind", async () => {
    await upsertAsset(workspace, { id: "a/b", kind: "text", content: "x" });
    await upsertAsset(workspace, {
      id: "a/c",
      kind: "bundle",
      files: { "f.txt": "hi" },
    });
    const bundles = await listAssets(workspace, { kind: "bundle" });
    expect(bundles.length).toBe(1);
    expect(bundles[0].kind).toBe("bundle");
  });
});

describe("assets.resolveAsset", () => {
  test("returns text content", async () => {
    await upsertAsset(workspace, { id: "x/y", kind: "text", content: "hello" });
    const r = await resolveAsset(workspace, "workspace", "x/y");
    expect(r.content).toBe("hello");
  });

  test("requires #file for bundles", async () => {
    await upsertAsset(workspace, {
      id: "x/y",
      kind: "bundle",
      files: { "a.txt": "alpha" },
    });
    await expect(resolveAsset(workspace, "workspace", "x/y")).rejects.toMatchObject({
      code: "file_required",
    });
    const r = await resolveAsset(workspace, "workspace", "x/y", undefined, "a.txt");
    expect(r.files?.["a.txt"]).toBe("base64:" + Buffer.from("alpha", "utf8").toString("base64"));
  });
});

describe("assets.deleteAsset", () => {
  test("marks specific version with .deleted marker", async () => {
    await upsertAsset(workspace, { id: "x/y", kind: "text", content: "a", version: "1.0.0" });
    await upsertAsset(workspace, { id: "x/y", kind: "text", content: "b", version: "2.0.0" });
    const result = await deleteAsset(workspace, "workspace", "x/y", "1.0.0");
    expect(result.removedVersions).toEqual(["1.0.0"]);
    const versions = await getAssetVersions(workspace, "workspace", "x/y");
    expect(versions.find((v) => v.version === "1.0.0")).toBeTruthy();
  });
});

describe("assets.diffAsset", () => {
  test("detects added/removed/modified files", async () => {
    const before = {
      schemaVersion: "1.0" as const,
      id: "x/y",
      scope: "workspace" as const,
      name: "y",
      kind: "bundle" as const,
      version: "1.0.0",
      mime: "application/octet-stream",
      tags: [],
      createdAt: "2024-01-01T00:00:00Z",
      createdBy: "user:t",
      updatedAt: "2024-01-01T00:00:00Z",
      updatedBy: "user:t",
      checksum: "sha256:a",
      size: 10,
      files: [
        { path: "a.txt", mime: "text/plain", size: 5, checksum: "sha256:1" },
        { path: "b.txt", mime: "text/plain", size: 5, checksum: "sha256:2" },
      ],
      permissions: { read: ["workspace"], write: ["owner"] },
      provenance: {},
    };
    const after = {
      ...before,
      version: "2.0.0",
      files: [
        { path: "b.txt", mime: "text/plain", size: 5, checksum: "sha256:9" },
        { path: "c.txt", mime: "text/plain", size: 5, checksum: "sha256:3" },
      ],
    };
    const d = diffAsset(before, after);
    expect(d.kindChanged).toBe(false);
    const ops = new Map(d.changedFiles.map((c) => [c.path, c.op]));
    expect(ops.get("a.txt")).toBe("removed");
    expect(ops.get("b.txt")).toBe("modified");
    expect(ops.get("c.txt")).toBe("added");
  });
});
