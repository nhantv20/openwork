import { execSync } from "node:child_process";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { listMcp } from "./mcp.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";

export interface McpStatus {
  name: string;
  type: string;
  endpoint: string;
  source: string;
  enabled: boolean;
  disabledByTools?: boolean;
  engineStatus: string | null;
  engineToolCount: number | null;
  processRunning: boolean | null;
  reachable: boolean | null;
  error: string | null;
}

function fetchEngineMcpStatuses(
  config: ServerConfig,
  workspace: WorkspaceInfo,
): Promise<Record<string, { status: string }> | null> {
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  const baseUrl = connection.baseUrl;
  if (!baseUrl) return Promise.resolve(null);

  const authHeader = connection.authHeader;
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;

  const directory = workspace.directory?.trim() || workspace.path;
  if (directory) headers["x-opencode-directory"] = directory.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "");

  return fetch(`${baseUrl.replace(/\/+$/, "")}/mcp`, { headers })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

async function checkRemoteReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

function checkProcessRunning(command: string): boolean {
  const cmd = command.trim().split(/\s+/)[0];
  if (!cmd) return false;
  const name = cmd.replace(/^.*[/\\]/, "").replace(/\.(exe|cmd|ps1)$/i, "");
  try {
    if (process.platform === "win32") {
      execSync(`Get-Process -Name "${name}" -ErrorAction SilentlyContinue`, {
        stdio: "pipe",
        timeout: 3000,
      });
      return true;
    }
    execSync(`pgrep -f "${name}"`, { stdio: "pipe", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function getMcpStatuses(
  config: ServerConfig,
  workspace: WorkspaceInfo,
): Promise<McpStatus[]> {
  const items = await listMcp(config, workspace.id, workspace.path);
  const engineStatuses = await fetchEngineMcpStatuses(config, workspace);

  const statuses: McpStatus[] = [];

  for (const item of items) {
    const cfg = item.config;
    const mcpType = String(cfg.type ?? "");
    const command = String(cfg.command ?? "");
    const url = String(cfg.url ?? "");
    const enabled = cfg.enabled !== false;

    const endpoint = command || url || "—";
    const engineInfo = engineStatuses?.[item.name] ?? null;
    const engineStatus = engineInfo?.status ?? null;

    let processRunning: boolean | null = null;
    let reachable: boolean | null = null;
    let error: string | null = null;

    if (mcpType === "local") {
      if (command) {
        try {
          processRunning = checkProcessRunning(command);
        } catch (e) {
          processRunning = false;
          error = String(e);
        }
      }
    } else if (mcpType === "remote") {
      if (url) {
        try {
          reachable = await checkRemoteReachable(url);
        } catch (e) {
          reachable = false;
          error = String(e);
        }
      }
    }

    statuses.push({
      name: item.name,
      type: mcpType || "unknown",
      endpoint,
      source: item.source,
      enabled,
      disabledByTools: item.disabledByTools,
      engineStatus,
      engineToolCount: null,
      processRunning,
      reachable,
      error,
    });
  }

  return statuses;
}
