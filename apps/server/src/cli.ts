#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCliArgs, printHelp, resolveServerConfig } from "./config.js";
import { createManagedOpencodeServer, type ManagedOpencodeServer } from "./managed-opencode.js";
import { createServerLogger, startServer, syncAllWorkspacesRuntimeMcpToEngine } from "./server.js";
import { ensureLocalWorkspaceFiles } from "./workspace-init.js";
import { findManagedEngineWorkspace } from "./workspaces.js";
import { keepOpenworkRuntimeConfigFileFresh, writeOpenworkRuntimeConfigFile } from "./openwork-runtime-config.js";
import pkg from "../package.json" with { type: "json" };

const args = parseCliArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.version) {
  console.log(pkg.version);
  process.exit(0);
}

const config = await resolveServerConfig(args);
const logger = createServerLogger(config);
const serverUrl = `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`;
let managedOpencode: ManagedOpencodeServer | null = null;

if (!config.readOnly) {
  await ensureLocalWorkspaceFiles(config.workspaces);
}

if (!config.opencodeBaseUrl && process.env.OPENWORK_MANAGE_OPENCODE === "1") {
  const workspace = findManagedEngineWorkspace(config.workspaces);
  if (workspace) {
    // Server-managed config file: the engine re-reads it from disk on every
    // instance rebuild, and keepOpenworkRuntimeConfigFileFresh rewrites it
    // on every runtime-DB write — so disposes always pick up current state.
    const runtimeConfigPath = await writeOpenworkRuntimeConfigFile(config, workspace.id);
    keepOpenworkRuntimeConfigFileFresh(config, workspace.id);
    const managedOpencodeCwd = process.env.OPENWORK_MANAGED_OPENCODE_CWD?.trim() || workspace.path;
    await mkdir(managedOpencodeCwd, { recursive: true });
    managedOpencode = await createManagedOpencodeServer({
      bin: process.env.OPENWORK_OPENCODE_BIN,
      cwd: managedOpencodeCwd,
      excludedPorts: [config.port],
      env: {
        ...(process.env.OPENWORK_DEV_MODE ? { OPENWORK_DEV_MODE: process.env.OPENWORK_DEV_MODE } : {}),
        ...(process.env.OPENWORK_UI_CONTROL_DISCOVERY ? { OPENWORK_UI_CONTROL_DISCOVERY: process.env.OPENWORK_UI_CONTROL_DISCOVERY } : {}),
        OPENWORK_SERVER_URL: serverUrl,
        OPENWORK_SERVER_TOKEN: config.token,
        OPENCODE_CONFIG: runtimeConfigPath,
      },
    });
    config.opencodeBaseUrl = managedOpencode.url;
    config.opencodeUsername = managedOpencode.username;
    config.opencodePassword = managedOpencode.password;
    for (const entry of config.workspaces) {
      entry.baseUrl ??= managedOpencode.url;
      entry.opencodeUsername ??= managedOpencode.username;
      entry.opencodePassword ??= managedOpencode.password;
      entry.directory ??= entry.path;
    }
    logger.log("info", `Managed OpenCode listening on ${managedOpencode.url}`);
  }
}

const server = await startServer(config);

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardScript = join(__dirname, "..", "scripts", "dashboard.mjs");
const dashboardPort = parseInt(process.env.MCP_DASHBOARD_PORT || "26320", 10);
const dashboardProcess = spawn("node", [dashboardScript], {
  cwd: join(__dirname, ".."),
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(dashboardPort),
    OPENWORK_SERVER_URL: serverUrl,
  },
});
dashboardProcess.on("error", (err) => {
  logger.log("error", `MCP Dashboard failed to start: ${err.message}`);
});
dashboardProcess.on("exit", (code) => {
  logger.log("info", `MCP Dashboard exited (code ${code})`);
});
logger.log("info", `MCP Dashboard at http://127.0.0.1:${dashboardPort}/dashboard`);

// The runtime config file above only covers workspaces[0]. Push every
// workspace's runtime-DB MCPs into the engine so they aren't invisible
// until a manual reload. Best-effort.
if (managedOpencode) {
  void syncAllWorkspacesRuntimeMcpToEngine(config);
}

const url = `http://${config.host}:${server.port}`;
logger.log("info", `OpenWork server listening on ${url}`);

if (config.tokenSource === "generated") {
  logger.log("info", `Client token: ${config.token}`);
}

if (config.hostTokenSource === "generated") {
  logger.log("info", `Host token: ${config.hostToken}`);
}

if (config.workspaces.length === 0) {
  logger.log("info", "No workspaces configured. Add --workspace or update server.json.");
} else {
  logger.log("info", `Workspaces: ${config.workspaces.length}`);
}

if (args.verbose) {
  logger.log("info", `Config path: ${config.configPath ?? "unknown"}`);
  logger.log("info", `Read-only: ${config.readOnly ? "true" : "false"}`);
  logger.log("info", `Approval: ${config.approval.mode} (${config.approval.timeoutMs}ms)`);
  logger.log("info", `CORS origins: ${config.corsOrigins.join(", ")}`);
  logger.log("info", `Authorized roots: ${config.authorizedRoots.join(", ")}`);
  logger.log("info", `Token source: ${config.tokenSource}`);
  logger.log("info", `Host token source: ${config.hostTokenSource}`);
}

const shutdown = async () => {
  // FIX BUG #4: graceful shutdown used to call `process.exit(0)`
  // immediately, which killed in-flight scheduled jobs mid-run and
  // left `running` rows in `runtime.sqlite` that the next boot had
  // to sweep with `failStaleRunningRuns`. The user would then see
  // false-positive "Server restarted while run was in flight"
  // failures. Now we await the server stop (which drains the
  // scheduler's 10s in-flight window) before exiting.
  try {
    await managedOpencode?.close();
  } catch (err) {
    logger.log("warn", `managed OpenCode close failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  dashboardProcess.kill();
  try {
    await (server as { stop?: (closeActiveConnections?: boolean) => Promise<void> }).stop?.(true);
  } catch (err) {
    logger.log("warn", `server stop failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

process.once("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});
process.once("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
