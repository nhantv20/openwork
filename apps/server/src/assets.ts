import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, rm, rename, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";

import type {
  AssetFileEntry,
  AssetKind,
  AssetManifest,
  AssetPermissions,
  AssetProvenance,
  AssetScope,
  AssetSummary,
  AssetVersion,
  ResolvedAsset,
} from "./types.js";
import {
  compareSemverLoose,
  isSemverLooseMatch,
  validateAssetId,
  validateAssetKind,
  validateAssetPath,
  validateAssetScope,
  validateAssetVersion,
} from "./validators.js";
import { ApiError } from "./errors.js";
import { exists, ensureDir, shortId } from "./utils.js";
import { projectAssetsDir } from "./workspace-files.js";

const ASSET_TEXT_THRESHOLD_BYTES = 1_048_576;
const ASSET_FILE_MAX_BYTES = 52_428_800;
const ASSET_BUNDLE_MAX_BYTES = 209_715_200;
const LOCK_STALE_MS = 30_000;

export interface AssetStorageOptions {
  textThresholdBytes?: number;
  fileMaxBytes?: number;
  bundleMaxBytes?: number;
}

export interface UpsertAssetPayload {
  id: string;
  name?: string;
  kind?: AssetKind;
  version?: string;
  mime?: string;
  tags?: string[];
  description?: string;
  content?: string;
  files?: Record<string, string>;
  bumpMessage?: string;
  createdBy?: string;
  parentVersion?: string;
  scope?: AssetScope;
  permissions?: AssetPermissions;
  provenance?: AssetProvenance;
}

export interface AssetFilter {
  scope?: AssetScope;
  q?: string;
  tag?: string;
  kind?: AssetKind;
  mime?: string;
}

function resolveStorageRoot(workspaceRoot: string, scope: AssetScope): string {
  if (scope === "local") {
    return join(homedir(), ".config", "openwork", "assets");
  }
  if (scope === "workspace") {
    return projectAssetsDir(workspaceRoot);
  }
  if (scope === "org") {
    return join(homedir(), ".config", "openwork", "assets-cache", "org", workspaceRoot.replace(/[^a-zA-Z0-9._-]/g, "_"));
  }
  if (scope === "hub") {
    return join(homedir(), ".config", "openwork", "assets-cache", "hub");
  }
  throw new ApiError(400, "invalid_asset_scope", `Unknown scope: ${scope}`);
}

function resolveAssetDir(storageRoot: string, scope: AssetScope, id: string): string {
  if (scope === "workspace") {
    return join(storageRoot, "workspace", id);
  }
  if (scope === "local") {
    return join(storageRoot, id);
  }
  if (scope === "org") {
    return join(storageRoot, id);
  }
  return join(storageRoot, id);
}

function splitId(id: string): { namespace: string; name: string } {
  const lastSlash = id.lastIndexOf("/");
  if (lastSlash <= 0) {
    return { namespace: "default", name: id };
  }
  return { namespace: id.slice(0, lastSlash), name: id.slice(lastSlash + 1) };
}

function sha256(buffer: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(buffer);
  return `sha256:${hash.digest("hex")}`;
}

function inferMimeFromPath(filePath: string, fallback?: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return fallback ?? "application/octet-stream";
  const map: Record<string, string> = {
    md: "text/markdown",
    json: "application/json",
    txt: "text/plain",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    ts: "application/typescript",
    tsx: "application/typescript",
    jsx: "application/javascript",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext] ?? fallback ?? "application/octet-stream";
}

interface LockHandle {
  path: string;
  nonce: string;
  pid: number;
  acquiredAt: number;
}

async function tryAcquireLock(lockPath: string): Promise<LockHandle | null> {
  await ensureDir(dirname(lockPath));
  const nonce = randomUUID();
  const pid = process.pid;
  const acquiredAt = Date.now();
  const handle: LockHandle = { path: lockPath, nonce, pid, acquiredAt };

  try {
    const handleFd = await import("node:fs/promises").then((m) => m.open(lockPath, "wx"));
    try {
      await handleFd.writeFile(JSON.stringify({ nonce, pid, acquiredAt }), "utf8");
    } finally {
      await handleFd.close();
    }
    return handle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  try {
    const statResult = await stat(lockPath);
    if (Date.now() - statResult.mtimeMs > LOCK_STALE_MS) {
      await rm(lockPath, { force: true });
      try {
        const handleFd = await import("node:fs/promises").then((m) => m.open(lockPath, "wx"));
        try {
          await handleFd.writeFile(JSON.stringify({ nonce, pid, acquiredAt }), "utf8");
        } finally {
          await handleFd.close();
        }
        return handle;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function releaseLock(handle: LockHandle): Promise<void> {
  try {
    const raw = await readFile(handle.path, "utf8");
    const data = JSON.parse(raw) as { nonce?: string };
    if (data.nonce !== handle.nonce) return;
  } catch {
    return;
  }
  await rm(handle.path, { force: true });
}

async function readManifest(versionDir: string): Promise<AssetManifest | null> {
  const manifestPath = join(versionDir, "manifest.json");
  if (!(await exists(manifestPath))) return null;
  const raw = await readFile(manifestPath, "utf8");
  try {
    return JSON.parse(raw) as AssetManifest;
  } catch {
    return null;
  }
}

async function readLatestPointer(assetDir: string): Promise<string | null> {
  const latestPath = join(assetDir, "latest");
  if (!(await exists(latestPath)) || (await stat(latestPath).catch(() => null))?.isDirectory()) {
    return null;
  }
  try {
    const raw = await readFile(latestPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

async function writeLatestPointer(assetDir: string, version: string): Promise<void> {
  const latestPath = join(assetDir, "latest");
  await writeFile(latestPath, `${JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

async function listVersionDirs(assetDir: string): Promise<string[]> {
  if (!(await exists(assetDir))) return [];
  const entries = await readdir(assetDir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "latest" || entry.name.startsWith(".")) continue;
    out.push(entry.name);
  }
  return out;
}

function resolveVersion(allVersions: string[], requested: string | undefined): string {
  if (!requested || requested === "latest") {
    return [...allVersions].sort(compareSemverLoose).pop() ?? "";
  }
  if (allVersions.includes(requested)) return requested;
  const matches = allVersions.filter((v) => isSemverLooseMatch(v, requested));
  if (matches.length === 0) {
    throw new ApiError(404, "asset_version_not_found", `No version matching '${requested}'`);
  }
  return [...matches].sort(compareSemverLoose).pop()!;
}

function normalizePayloadBytes(value: string): Buffer {
  const base64Match = /^base64:/i;
  if (base64Match.test(value)) {
    return Buffer.from(value.slice("base64:".length), "base64");
  }
  return Buffer.from(value, "utf8");
}

function encodeBytesForJson(buffer: Buffer): string {
  return `base64:${buffer.toString("base64")}`;
}

function buildFileEntry(filePath: string, bytes: Buffer): AssetFileEntry {
  validateAssetPath(filePath);
  return {
    path: filePath,
    mime: inferMimeFromPath(filePath),
    size: bytes.length,
    checksum: sha256(bytes),
  };
}

function nextSemverBump(current: string, breaking: boolean): string {
  const match = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return `${current}-1`;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (breaking) return `${major + 1}.0.0`;
  if (current.includes("-") || /\d/.test(current) === false) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export async function listAssets(
  workspaceRoot: string,
  filter: AssetFilter = {},
  options: AssetStorageOptions = {},
): Promise<AssetSummary[]> {
  const scopes: AssetScope[] = filter.scope ? [filter.scope] : ["workspace", "local"];
  const out: AssetSummary[] = [];

  for (const scope of scopes) {
    const root = resolveStorageRoot(workspaceRoot, scope);
    if (!(await exists(root))) continue;
    const baseDir = scope === "workspace" ? join(root, "workspace") : root;
    if (!(await exists(baseDir))) continue;
    const stack = [baseDir];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      const latest = await readLatestPointer(dir);
      let manifest: AssetManifest | null = null;
      if (latest) manifest = await readManifest(join(dir, latest));
      if (manifest) {
        if (filter.q) {
          const haystack = `${manifest.name} ${manifest.id} ${manifest.description ?? ""} ${manifest.tags.join(" ")}`.toLowerCase();
          if (!haystack.includes(filter.q.toLowerCase())) {
            continue;
          }
        }
        if (filter.tag && !manifest.tags.includes(filter.tag)) continue;
        if (filter.kind && manifest.kind !== filter.kind) continue;
        if (filter.mime && !manifest.mime.startsWith(filter.mime)) continue;
        out.push({
          id: manifest.id,
          scope: manifest.scope,
          name: manifest.name,
          kind: manifest.kind,
          version: manifest.version,
          tags: manifest.tags,
          mime: manifest.mime,
          size: manifest.size,
          updatedAt: manifest.updatedAt,
        });
      } else {
        for (const entry of entries) {
          if (entry.isDirectory()) stack.push(join(dir, entry.name));
        }
      }
    }
  }

  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getAsset(
  workspaceRoot: string,
  scope: AssetScope,
  id: string,
  version?: string,
): Promise<AssetManifest> {
  validateAssetScope(scope);
  validateAssetId(id);
  if (version) validateAssetVersion(version);

  const root = resolveStorageRoot(workspaceRoot, scope);
  const assetDir = resolveAssetDir(root, scope, id);
  if (!(await exists(assetDir))) {
    throw new ApiError(404, "asset_not_found", `Asset not found: ${id}`);
  }
  const versions = await listVersionDirs(assetDir);
  if (versions.length === 0) {
    throw new ApiError(404, "asset_not_found", `Asset has no versions: ${id}`);
  }
  const resolved = resolveVersion(versions, version);
  const manifest = await readManifest(join(assetDir, resolved));
  if (!manifest) {
    throw new ApiError(500, "asset_corrupt", `Manifest missing for ${id}@${resolved}`);
  }
  return manifest;
}

export async function getAssetVersions(
  workspaceRoot: string,
  scope: AssetScope,
  id: string,
): Promise<AssetVersion[]> {
  validateAssetScope(scope);
  validateAssetId(id);
  const root = resolveStorageRoot(workspaceRoot, scope);
  const assetDir = resolveAssetDir(root, scope, id);
  const versions = await listVersionDirs(assetDir);
  const out: AssetVersion[] = [];
  for (const version of versions) {
    const manifest = await readManifest(join(assetDir, version));
    if (!manifest) continue;
    out.push({
      version: manifest.version,
      size: manifest.size,
      checksum: manifest.checksum,
      createdAt: manifest.createdAt,
      createdBy: manifest.createdBy,
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function upsertAsset(
  workspaceRoot: string,
  payload: UpsertAssetPayload,
  options: AssetStorageOptions = {},
): Promise<AssetManifest> {
  validateAssetId(payload.id);
  const scope: AssetScope = payload.scope ?? "workspace";
  validateAssetScope(scope);
  const kind: AssetKind = payload.kind ?? "text";
  validateAssetKind(kind);

  const root = resolveStorageRoot(workspaceRoot, scope);
  const assetDir = resolveAssetDir(root, scope, payload.id);
  await ensureDir(assetDir);

  const lock = await tryAcquireLock(join(assetDir, ".lock"));
  if (!lock) {
    throw new ApiError(409, "asset_locked", `Asset is being modified: ${payload.id}`);
  }

  try {
    const existingVersions = await listVersionDirs(assetDir);
    const latestExisting = existingVersions.length
      ? [...existingVersions].sort(compareSemverLoose).pop()!
      : null;
    const previousManifest = latestExisting ? await readManifest(join(assetDir, latestExisting)) : null;

    if (previousManifest && payload.parentVersion && previousManifest.version !== payload.parentVersion) {
      throw new ApiError(409, "asset_version_conflict", "Parent version mismatch", {
        expected: payload.parentVersion,
        current: previousManifest.version,
      });
    }

    const textThreshold = options.textThresholdBytes ?? ASSET_TEXT_THRESHOLD_BYTES;
    const fileMax = options.fileMaxBytes ?? ASSET_FILE_MAX_BYTES;
    const bundleMax = options.bundleMaxBytes ?? ASSET_BUNDLE_MAX_BYTES;

    let payloadBytes: Buffer;
    let manifestFiles: AssetFileEntry[] | undefined;
    let primaryMime: string;
    let totalSize = 0;

    if (kind === "text") {
      if (typeof payload.content !== "string") {
        throw new ApiError(400, "invalid_asset_payload", "Text asset requires string content");
      }
      payloadBytes = Buffer.from(payload.content, "utf8");
      if (payloadBytes.length > textThreshold) {
        throw new ApiError(413, "asset_too_large", `Text asset exceeds ${textThreshold} bytes; use kind=file`);
      }
      primaryMime = payload.mime ?? "text/markdown";
    } else if (kind === "file") {
      if (typeof payload.content !== "string") {
        throw new ApiError(400, "invalid_asset_payload", "File asset requires content (base64:...)");
      }
      payloadBytes = normalizePayloadBytes(payload.content);
      if (payloadBytes.length > fileMax) {
        throw new ApiError(413, "asset_too_large", `File asset exceeds ${fileMax} bytes`);
      }
      primaryMime = payload.mime ?? "application/octet-stream";
      manifestFiles = [buildFileEntry(previousManifest?.files?.[0]?.path ?? "payload", payloadBytes)];
    } else {
      if (!payload.files || typeof payload.files !== "object") {
        throw new ApiError(400, "invalid_asset_payload", "Bundle asset requires files record");
      }
      const entries: AssetFileEntry[] = [];
      const buffers: { path: string; bytes: Buffer }[] = [];
      let bundleSize = 0;
      for (const [path, raw] of Object.entries(payload.files)) {
        validateAssetPath(path);
        if (path === "manifest.json" || path === "latest" || path === ".lock") {
          throw new ApiError(400, "invalid_asset_path", `Reserved file name: ${path}`);
        }
        const bytes = normalizePayloadBytes(raw);
        bundleSize += bytes.length;
        if (bundleSize > bundleMax) {
          throw new ApiError(413, "asset_too_large", `Bundle exceeds ${bundleMax} bytes`);
        }
        entries.push(buildFileEntry(path, bytes));
        buffers.push({ path, bytes });
      }
      if (entries.length === 0) {
        throw new ApiError(400, "invalid_asset_payload", "Bundle must have at least one file");
      }
      payloadBytes = Buffer.concat(buffers.map((b) => b.bytes));
      manifestFiles = entries;
      primaryMime = payload.mime ?? entries[0]?.mime ?? "application/octet-stream";
      totalSize = bundleSize;
    }

    if (kind !== "bundle") totalSize = payloadBytes.length;

    const version = payload.version ?? (latestExisting ? nextSemverBump(latestExisting, kind === "bundle" && !!previousManifest && previousManifest.kind !== "bundle") : "1.0.0");
    validateAssetVersion(version);

    if (existingVersions.includes(version)) {
      throw new ApiError(409, "asset_version_exists", `Version exists: ${version}`);
    }

    const versionDir = join(assetDir, version);
    await ensureDir(versionDir);

    const now = new Date().toISOString();
    const manifest: AssetManifest = {
      schemaVersion: "1.0",
      id: payload.id,
      scope,
      name: payload.name ?? previousManifest?.name ?? splitId(payload.id).name,
      kind,
      version,
      mime: primaryMime,
      tags: payload.tags ?? previousManifest?.tags ?? [],
      description: payload.description ?? previousManifest?.description,
      createdAt: previousManifest?.createdAt ?? now,
      createdBy: previousManifest?.createdBy ?? payload.createdBy ?? "system",
      updatedAt: now,
      updatedBy: payload.createdBy ?? previousManifest?.updatedBy ?? "system",
      checksum: sha256(payloadBytes),
      size: totalSize,
      files: manifestFiles,
      permissions: payload.permissions ?? previousManifest?.permissions ?? { read: ["workspace"], write: ["owner"] },
      provenance: {
        ...(previousManifest?.provenance ?? {}),
        ...(payload.provenance ?? {}),
        parentVersion: latestExisting ?? undefined,
      },
    };

    const manifestPath = join(versionDir, "manifest.json");
    const manifestTmp = `${manifestPath}.tmp`;
    await writeFile(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(manifestTmp, manifestPath);

    if (kind === "bundle" && payload.files) {
      for (const [path, raw] of Object.entries(payload.files)) {
        const bytes = normalizePayloadBytes(raw);
        const filePath = join(versionDir, path);
        await ensureDir(dirname(filePath));
        const tmpPath = `${filePath}.tmp`;
        await writeFile(tmpPath, bytes);
        await rename(tmpPath, filePath);
      }
    } else if (kind === "file") {
      const fileName = manifestFiles?.[0]?.path ?? "payload";
      const filePath = join(versionDir, fileName);
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, payloadBytes);
      await rename(tmpPath, filePath);
    } else {
      const filePath = join(versionDir, "content.md");
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, payloadBytes);
      await rename(tmpPath, filePath);
    }

    await writeLatestPointer(assetDir, version);
    return manifest;
  } finally {
    await releaseLock(lock);
  }
}

export async function deleteAsset(
  workspaceRoot: string,
  scope: AssetScope,
  id: string,
  version?: string,
): Promise<{ removedVersions: string[] }> {
  validateAssetScope(scope);
  validateAssetId(id);
  if (version) validateAssetVersion(version);
  const root = resolveStorageRoot(workspaceRoot, scope);
  const assetDir = resolveAssetDir(root, scope, id);
  if (!(await exists(assetDir))) {
    throw new ApiError(404, "asset_not_found", `Asset not found: ${id}`);
  }
  const existing = await listVersionDirs(assetDir);
  if (existing.length === 0) {
    throw new ApiError(404, "asset_not_found", `Asset has no versions: ${id}`);
  }
  if (version) {
    if (!existing.includes(version)) {
      throw new ApiError(404, "asset_version_not_found", `Version not found: ${version}`);
    }
    const versionDir = join(assetDir, version);
    await writeFile(join(versionDir, ".deleted"), `${JSON.stringify({ at: new Date().toISOString() })}\n`, "utf8");
    return { removedVersions: [version] };
  }
  const removed: string[] = [];
  for (const v of existing) {
    const versionDir = join(assetDir, v);
    await writeFile(join(versionDir, ".deleted"), `${JSON.stringify({ at: new Date().toISOString() })}\n`, "utf8");
    removed.push(v);
  }
  await rm(join(assetDir, "latest"), { force: true });
  return { removedVersions: removed };
}

export async function resolveAsset(
  workspaceRoot: string,
  scope: AssetScope,
  id: string,
  version: string | undefined,
  file?: string,
): Promise<ResolvedAsset> {
  validateAssetScope(scope);
  validateAssetId(id);
  if (version) validateAssetVersion(version);
  if (file) validateAssetPath(file);
  const manifest = await getAsset(workspaceRoot, scope, id, version);
  const root = resolveStorageRoot(workspaceRoot, scope);
  const assetDir = resolveAssetDir(root, scope, id);
  const versionDir = join(assetDir, manifest.version);

  if (manifest.kind === "text") {
    const contentPath = join(versionDir, "content.md");
    const content = await readFile(contentPath, "utf8");
    return { manifest, content };
  }
  if (manifest.kind === "file") {
    const fileName = manifest.files?.[0]?.path ?? "payload";
    const bytes = await readFile(join(versionDir, fileName));
    return { manifest, bytes: encodeBytesForJson(bytes) };
  }
  if (!file) {
    throw new ApiError(400, "file_required", "Bundle assets require #file in reference");
  }
  const bytes = await readFile(join(versionDir, file));
  return {
    manifest,
    files: { [file]: encodeBytesForJson(bytes) },
  };
}

export async function listAssetReferences(
  workspaceRoot: string,
  scope: AssetScope,
  id: string,
): Promise<AssetVersion[]> {
  return getAssetVersions(workspaceRoot, scope, id);
}

export function diffAsset(
  before: AssetManifest,
  after: AssetManifest,
): { changedFiles: Array<{ path: string; op: "added" | "removed" | "modified" }>; kindChanged: boolean } {
  const beforeFiles = new Map((before.files ?? []).map((f) => [f.path, f]));
  const afterFiles = new Map((after.files ?? []).map((f) => [f.path, f]));
  const changed: Array<{ path: string; op: "added" | "removed" | "modified" }> = [];

  for (const [path, afterEntry] of afterFiles) {
    const beforeEntry = beforeFiles.get(path);
    if (!beforeEntry) {
      changed.push({ path, op: "added" });
    } else if (beforeEntry.checksum !== afterEntry.checksum) {
      changed.push({ path, op: "modified" });
    }
  }
  for (const path of beforeFiles.keys()) {
    if (!afterFiles.has(path)) {
      changed.push({ path, op: "removed" });
    }
  }
  return { changedFiles: changed, kindChanged: before.kind !== after.kind };
}
