import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recordAssetReference,
  listAssetReferences,
  compactAssetReferences,
  findAssetsReferencedBy,
} from "./asset-references-store.js";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "openwork-refs-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("asset-references-store", () => {
  test("records and lists references for an asset", () => {
    recordAssetReference(workspace, {
      assetId: "acme/letterhead",
      refKind: "skill",
      refId: "brand-docx",
      at: Date.now(),
    });
    const refs = listAssetReferences(workspace, "acme/letterhead");
    expect(refs.length).toBe(1);
    expect(refs[0].refId).toBe("brand-docx");
  });

  test("deduplicates identical references (updates timestamp)", () => {
    const t1 = Date.now();
    recordAssetReference(workspace, { assetId: "x/y", refKind: "skill", refId: "s1", at: t1 });
    recordAssetReference(workspace, { assetId: "x/y", refKind: "skill", refId: "s1", at: t1 + 1000 });
    const refs = listAssetReferences(workspace, "x/y");
    expect(refs.length).toBe(1);
    expect(refs[0].at).toBe(t1 + 1000);
  });

  test("findAssetsReferencedBy returns all assets linked to a ref", () => {
    recordAssetReference(workspace, { assetId: "a/1", refKind: "session", refId: "ses_abc", at: Date.now() });
    recordAssetReference(workspace, { assetId: "a/2", refKind: "session", refId: "ses_abc", at: Date.now() });
    recordAssetReference(workspace, { assetId: "a/3", refKind: "session", refId: "ses_xyz", at: Date.now() });
    const found = findAssetsReferencedBy(workspace, "session", "ses_abc");
    expect(found.length).toBe(2);
    expect(found.map((r) => r.assetId).sort()).toEqual(["a/1", "a/2"]);
  });

  test("compact removes entries older than TTL", () => {
    const old = Date.now() - 60_000;
    const recent = Date.now();
    recordAssetReference(workspace, { assetId: "x/old", refKind: "skill", refId: "s1", at: old });
    recordAssetReference(workspace, { assetId: "x/new", refKind: "skill", refId: "s1", at: recent });
    const removed = compactAssetReferences(workspace, 30_000);
    expect(removed).toBe(1);
    const remaining = listAssetReferences(workspace, "x/old");
    expect(remaining.length).toBe(0);
  });
});
