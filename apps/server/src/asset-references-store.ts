import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type AssetReferenceKind = "skill" | "session" | "mcp" | "plugin";

export interface AssetReference {
  assetId: string;
  refKind: AssetReferenceKind;
  refId: string;
  at: number;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function resolveStorePath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "openwork", "asset-references.json");
}

interface StoreShape {
  version: 1;
  updatedAt: number;
  references: AssetReference[];
}

function readStore(workspaceRoot: string): StoreShape {
  const path = resolveStorePath(workspaceRoot);
  if (!existsSync(path)) return { version: 1, updatedAt: 0, references: [] };
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      references: Array.isArray(parsed.references) ? parsed.references : [],
    };
  } catch {
    return { version: 1, updatedAt: 0, references: [] };
  }
}

function writeStore(workspaceRoot: string, store: StoreShape): void {
  const path = resolveStorePath(workspaceRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function recordAssetReference(workspaceRoot: string, ref: AssetReference): void {
  const store = readStore(workspaceRoot);
  const existingIdx = store.references.findIndex(
    (r) => r.assetId === ref.assetId && r.refKind === ref.refKind && r.refId === ref.refId,
  );
  if (existingIdx >= 0) {
    store.references[existingIdx] = ref;
  } else {
    store.references.push(ref);
  }
  store.updatedAt = Date.now();
  writeStore(workspaceRoot, store);
}

export function listAssetReferences(workspaceRoot: string, assetId: string): AssetReference[] {
  const store = readStore(workspaceRoot);
  return store.references.filter((r) => r.assetId === assetId);
}

export function compactAssetReferences(workspaceRoot: string, ttlMs: number = DEFAULT_TTL_MS): number {
  const store = readStore(workspaceRoot);
  const cutoff = Date.now() - ttlMs;
  const before = store.references.length;
  store.references = store.references.filter((r) => r.at > cutoff);
  const removed = before - store.references.length;
  if (removed > 0) {
    store.updatedAt = Date.now();
    writeStore(workspaceRoot, store);
  }
  return removed;
}

export function findAssetsReferencedBy(
  workspaceRoot: string,
  refKind: AssetReferenceKind,
  refId: string,
): AssetReference[] {
  const store = readStore(workspaceRoot);
  return store.references.filter((r) => r.refKind === refKind && r.refId === refId);
}
