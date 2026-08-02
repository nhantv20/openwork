import { ApiError } from "./errors.js";

const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COMMAND_NAME_REGEX = /^[A-Za-z0-9_-]+$/;
const MCP_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

export function validateSkillName(name: string): void {
  if (!name || name.length < 1 || name.length > 64 || !SKILL_NAME_REGEX.test(name)) {
    throw new ApiError(400, "invalid_skill_name", "Skill name must be kebab-case (1-64 chars)");
  }
}

export function validateDescription(description: string | undefined): void {
  if (!description || description.length < 1 || description.length > 1024) {
    throw new ApiError(422, "invalid_description", "Description must be 1-1024 characters");
  }
}

export function validatePluginSpec(spec: string): void {
  if (!spec || spec.trim().length === 0) {
    throw new ApiError(400, "invalid_plugin_spec", "Plugin spec is required");
  }
}

export function sanitizeCommandName(name: string): string {
  const trimmed = name.trim().replace(/^\/+/, "");
  return trimmed;
}

export function validateCommandName(name: string): void {
  if (!name || !COMMAND_NAME_REGEX.test(name)) {
    throw new ApiError(400, "invalid_command_name", "Command name must be alphanumeric with _ or -");
  }
}

export function validateMcpName(name: string): void {
  if (!name || name.startsWith("-") || !MCP_NAME_REGEX.test(name)) {
    throw new ApiError(400, "invalid_mcp_name", "MCP name must be alphanumeric and not start with -");
  }
}

export function validateMcpConfig(config: Record<string, unknown>): void {
  const type = config.type;
  if (type !== "local" && type !== "remote") {
    throw new ApiError(400, "invalid_mcp_config", "MCP config type must be local or remote");
  }
  if (type === "local") {
    const command = config.command;
    if (
      !Array.isArray(command) ||
      command.length === 0 ||
      command.some((part) => typeof part !== "string" || part.trim().length === 0)
    ) {
      throw new ApiError(400, "invalid_mcp_config", "Local MCP requires command array");
    }
  }
  if (type === "remote") {
    const url = config.url;
    if (!url || typeof url !== "string" || url.trim().length === 0) {
      throw new ApiError(400, "invalid_mcp_config", "Remote MCP requires url");
    }
    const normalizedUrl = url.trim();
    if (url !== normalizedUrl) {
      throw new ApiError(400, "invalid_mcp_config", "Remote MCP url must not include surrounding whitespace");
    }
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      throw new ApiError(400, "invalid_mcp_config", "Remote MCP url must start with http(s)://");
    }
    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ApiError(400, "invalid_mcp_config", "Remote MCP url must use http(s)");
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "invalid_mcp_config", "Remote MCP requires a valid url");
    }
  }
}

const ASSET_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;
const ASSET_VERSION_REGEX = /^[a-zA-Z0-9._+-]+$/;
const ASSET_PATH_REGEX = /^(?!\.\.)(?!\/)[^\x00-\x1f\\:*?"<>|]+$/;

export const ASSET_SCOPES = ["local", "workspace", "org", "hub"] as const;
export const ASSET_KINDS = ["file", "bundle", "text"] as const;

export function validateAssetId(id: string): void {
  if (!id || id.length > 128 || !ASSET_ID_REGEX.test(id)) {
    throw new ApiError(400, "invalid_asset_id", "Asset id must be kebab-case segments (e.g. 'acme/letterhead')");
  }
}

export function validateAssetVersion(version: string): void {
  if (!version || version.length > 64 || !ASSET_VERSION_REGEX.test(version)) {
    throw new ApiError(400, "invalid_asset_version", "Asset version must be 1-64 chars [a-zA-Z0-9._+-]");
  }
}

export function validateAssetPath(filePath: string): void {
  if (!filePath || filePath.length > 256 || !ASSET_PATH_REGEX.test(filePath)) {
    throw new ApiError(400, "invalid_asset_path", "Asset file path must be relative and free of reserved characters");
  }
}

export function validateAssetScope(scope: string): asserts scope is typeof ASSET_SCOPES[number] {
  if (!ASSET_SCOPES.includes(scope as typeof ASSET_SCOPES[number])) {
    throw new ApiError(400, "invalid_asset_scope", `Asset scope must be one of: ${ASSET_SCOPES.join(", ")}`);
  }
}

export function validateAssetKind(kind: string): asserts kind is typeof ASSET_KINDS[number] {
  if (!ASSET_KINDS.includes(kind as typeof ASSET_KINDS[number])) {
    throw new ApiError(400, "invalid_asset_kind", `Asset kind must be one of: ${ASSET_KINDS.join(", ")}`);
  }
}

export function parseAssetReference(input: string): {
  scheme: "asset";
  scope: typeof ASSET_SCOPES[number];
  id: string;
  version?: string;
  file?: string;
} | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed.startsWith("asset://")) return null;
  const rest = trimmed.slice("asset://".length);
  const hashIndex = rest.indexOf("#");
  const pathPart = hashIndex >= 0 ? rest.slice(hashIndex + 1) : undefined;
  const withoutHash = hashIndex >= 0 ? rest.slice(0, hashIndex) : rest;
  const atIndex = withoutHash.lastIndexOf("@");
  const head = atIndex > 0 ? withoutHash.slice(0, atIndex) : withoutHash;
  const version = atIndex > 0 ? withoutHash.slice(atIndex + 1) : undefined;
  const slashIndex = head.indexOf("/");
  if (slashIndex <= 0) return null;
  const scope = head.slice(0, slashIndex);
  const id = head.slice(slashIndex + 1);
  if (!ASSET_SCOPES.includes(scope as typeof ASSET_SCOPES[number])) return null;
  if (version) {
    try {
      validateAssetVersion(version);
    } catch {
      return null;
    }
  }
  if (pathPart) {
    try {
      validateAssetPath(pathPart);
    } catch {
      return null;
    }
  }
  return { scheme: "asset", scope: scope as typeof ASSET_SCOPES[number], id, version, file: pathPart };
}

export function compareSemverLoose(a: string, b: string): number {
  const parse = (v: string) => {
    const cleaned = v.replace(/^v/, "");
    const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
  };
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

export function isSemverLooseMatch(version: string, target: string): boolean {
  if (version === target) return true;
  const re = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
  const tm = target.match(re);
  const vm = version.match(re);
  if (!tm || !vm) return false;
  if (tm[2] === undefined) return vm[1] === tm[1];
  if (tm[3] === undefined) return vm[1] === tm[1] && vm[2] === tm[2];
  return version === target;
}
