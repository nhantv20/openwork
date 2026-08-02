/**
 * Runtime OpenCode configuration injected via a server-managed config file
 * passed to the engine as OPENCODE_CONFIG.
 *
 * This is the single source of truth for the openwork agent definition,
 * plugins, and any other config that should be injected at runtime rather
 * than written to the user's own config files. Both cli.ts and embedded.ts
 * use this.
 *
 * The engine re-reads the OPENCODE_CONFIG file from disk on every instance
 * rebuild (e.g. /instance/dispose), so the file is rewritten on every
 * runtime-DB write — unlike the previous OPENCODE_CONFIG_CONTENT env var,
 * which was frozen at spawn and reverted MCP state on each dispose.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EnvService } from "./env-file.js";
import {
  openworkExtensionsPreviewPluginPath,
  openworkCapabilitiesKnowledgePluginPath,
  openworkAnthropicAdaptiveThinkingPluginPath,
  openworkAnthropicToolSchemaPluginPath,
} from "./openwork-extensions-plugin-path.js";
import type { ServerConfig } from "./types.js";
import {
  onRuntimeOpencodeConfigWrite,
  readRuntimeOpencodeConfig,
  runtimeDisabledProviderList,
  runtimeMcpMap,
  runtimePluginList,
  runtimeStorageDir,
} from "./runtime-opencode-config-store.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FPT_DEFAULT_MODELS: Record<string, unknown> = {
  "Qwen3.6-27B": {
    name: "Qwen3.6-27B",
    // Hint to Vercel AI SDK to attach Anthropic-style `cache_control: ephemeral`
    // markers on each message so FPT can warm a system-prompt cache after the
    // first ~2 requests. From request #3 onward, `cached_tokens` should be
    // > 0 and the per-request charge against the FPT TPM quota drops sharply.
    // If your build of the AI SDK doesn't surface this, see
    // `opencode-plugins/openwork-fpt-cache-control.ts` for the plugin fallback.
    cacheControl: { type: "ephemeral" },
  },
  "DeepSeek-V4-Flash": {
    name: "DeepSeek-V4-Flash",
    // DeepSeek already caches by FPT default once the conversation prefix is
    // stable, but adding the explicit hint makes the first call a cache miss
    // deterministic (no surprise mid-session re-warming).
    cacheControl: { type: "ephemeral" },
  },
};

const FPT_DEFAULT_BASE_URL = "https://mkp-api.fptcloud.com/v1";

/**
 * Read FPT Cloud AI configuration from user environment variables
 * (set via Settings → Environment).
 *
 * - `FPT_API_KEY` (required) — API key to activate the provider
 * - `FPT_CONFIG` (optional) — JSON string to override models / baseURL:
 *     { "models": { "Model-X": { "name": "Model-X" } }, "baseURL": "..." }
 * - `FPT_PROXY_BASE_URL` (optional) — baseURL to use instead of the FPT
 *   default / FPT_CONFIG.baseURL. Set this to point the provider at a
 *   local pass-through proxy (see scripts/fpt-proxy). Takes precedence
 *   over FPT_CONFIG.baseURL.
 * - `FPT_LIGHT_MODE` (optional, "1"/"true") — trim the opencode runtime
 *   config used for FPT sessions: drop MCPs entirely and only keep
 *   `opencode-chrome-devtools` + `openwork-anthropic-tool-schema` plugins
 *   (the two that add the fewest tools). Use this to lower per-request
 *   prompt token cost when FPT rate-limits on TPM. Ignored if FPT_API_KEY
 *   is not set.
 * - `FPT_DISABLE_PLUGINS` (optional) — comma-separated plugin names to
 *   exclude even outside light mode (e.g. `linear,figma`). Substring match,
 *   so `chrome-devtools` matches `opencode-chrome-devtools`.
 * - `FPT_DISABLE_MCPS` (optional) — comma-separated MCP names to exclude
 *   from the runtime config (e.g. `linear,figma`).
 *
 * Returns `null` when `FPT_API_KEY` is not set (provider not configured).
 */
async function readFptProviderFromEnv(): Promise<{
  provider: Record<string, unknown>;
  lightMode: boolean;
  disabledPlugins: string[];
  disabledMcps: string[];
} | null> {
  const env = await EnvService.readForInjection();
  const apiKey = env.FPT_API_KEY?.trim();
  if (!apiKey) return null;

  let models = FPT_DEFAULT_MODELS;
  let baseURL = FPT_DEFAULT_BASE_URL;

  // `FPT_PROXY_BASE_URL` wins over `FPT_CONFIG.baseURL` and over the default.
  // Use this to point the FPT provider at a local pass-through proxy
  // (e.g. `scripts/fpt-proxy/server.ts`) for rate-limit observation/throttling
  // without changing what end users see in the Settings UI.
  const proxyBaseURL = env.FPT_PROXY_BASE_URL?.trim();
  if (proxyBaseURL) baseURL = proxyBaseURL;

  const rawConfig = env.FPT_CONFIG?.trim();
  if (rawConfig) {
    try {
      const parsed = JSON.parse(rawConfig) as Record<string, unknown>;
      if (isRecord(parsed.models)) models = parsed.models;
      if (typeof parsed.baseURL === "string" && parsed.baseURL) baseURL = parsed.baseURL;
    } catch {
      // Ignore invalid JSON — fall back to defaults
    }
  }

  const lightMode = /^(1|true|yes|on)$/i.test(env.FPT_LIGHT_MODE?.trim() ?? "");
  const disabledPlugins = (env.FPT_DISABLE_PLUGINS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const disabledMcps = (env.FPT_DISABLE_MCPS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  return {
    provider: {
      fpt: {
        name: "fpt",
        npm: "@ai-sdk/openai-compatible",
        models,
        options: {
          baseURL,
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      },
    },
    lightMode,
    disabledPlugins,
    disabledMcps,
  };
}

function isNameDisabled(name: string, disabled: string[]): boolean {
  const lower = name.toLowerCase();
  return disabled.some((d) => lower.includes(d.toLowerCase()));
}

const OPENWORK_AGENT_PROMPT = `You are OpenWork.

When the user refers to "you", they mean the OpenWork app and the current workspace.

Your job:
- Help the user work on files safely.
- Automate repeatable work.
- Keep behavior portable and reproducible.

## Memory

Two kinds:
1. Behavior memory (shareable, in git): .opencode/skills/**, .opencode/agents/**, repo docs
2. Private memory (never commit): tokens, credentials, local config, logs

Hard rule: never copy private memory into repo files. Store only redacted summaries, schemas, and stable pointers.

## Working style

- If required setup or credentials are missing, ask one targeted question and continue once provided.
- If you change code, run the smallest meaningful test.
- If steps repeat, factor them into a skill.
- Prefer clear, practical steps over abstract explanations.

## OpenWork Artifacts

OpenWork can preview, edit, and download standard artifacts when you create or update them in the workspace.

- Prefer standard output files for user-visible deliverables: Markdown (.md), CSV (.csv), Excel workbooks (.xlsx), PowerPoint decks (.pptx), and browser previews (index.html or a local http://localhost:<port> URL).
- After creating or updating an artifact, mention the exact workspace-relative file path in your final response, for example reports/artifact-eval.md or reports/artifact-eval.xlsx.
- Do not invent Workspace/<id>/... paths unless a tool returns them; prefer clean workspace-relative paths.
- For websites or React/UI previews, start the dev server when useful and mention the http://localhost:<port> URL.
- For spreadsheets, use .csv for simple tabular data and .xlsx when the user asks for Excel/XLS specifically.`;

export async function buildOpenworkRuntimeConfigObject(
  config?: ServerConfig,
  workspaceId?: string,
): Promise<Record<string, unknown>> {
  const runtimeConfig = config && workspaceId ? await readRuntimeOpencodeConfig(config, workspaceId) : {};
  const disabledProviders = runtimeDisabledProviderList(runtimeConfig);
  const runtimeProvider = isRecord(runtimeConfig.provider) ? runtimeConfig.provider : {};
  const fpt = await readFptProviderFromEnv();
  const mergedProvider = fpt?.provider
    ? { ...fpt.provider, ...runtimeProvider }
    : runtimeProvider;

  // Plugins: when FPT is active and light mode is on, drop the heavy
  // opencode-internal plugins to lower per-request tool-definition token
  // cost. Filter applies the user's FPT_DISABLE_PLUGINS list in either mode.
  const basePlugins = [
    "opencode-chrome-devtools",
    openworkExtensionsPreviewPluginPath(),
    openworkCapabilitiesKnowledgePluginPath(),
    openworkAnthropicAdaptiveThinkingPluginPath(),
    openworkAnthropicToolSchemaPluginPath(),
    ...runtimePluginList(runtimeConfig),
  ];
  // In light mode keep only the chrome-devtools plugin and the
  // tool-schema plugin (small tool footprint). All other openwork-internal
  // plugins are skipped because each registers its own tool surface.
  const heavyPluginMarkers = fpt?.lightMode
    ? ["openwork-extensions-preview", "openwork-capabilities-knowledge", "openwork-anthropic-adaptive-thinking"]
    : [];
  const disabledPluginMarkers = [...heavyPluginMarkers, ...(fpt?.disabledPlugins ?? [])];
  const plugins = basePlugins.filter((p) => !isNameDisabled(p, disabledPluginMarkers));

  // MCPs: light mode drops all MCPs (each MCP contributes its tool list to
  // the prompt). Otherwise apply FPT_DISABLE_MCPS filter on top of the
  // workspace's runtime MCP map.
  const allMcps = runtimeMcpMap(runtimeConfig);
  const mcps = fpt?.lightMode
    ? {}
    : Object.fromEntries(
        Object.entries(allMcps).filter(([name]) => !isNameDisabled(name, fpt?.disabledMcps ?? [])),
      );

  // Log a one-line cost estimate so the operator can see the impact of
  // light mode / filter changes when an Apply Changes hits the engine.
  const tpmHint = estimatePluginTokenCost(plugins, mcps);
  console.log(
    `[openwork-runtime-config] plugins=${plugins.length} mcps=${Object.keys(mcps).length} ` +
      `fpt=${fpt ? (fpt.lightMode ? "light" : "full") : "off"} est_token_cost=${tpmHint}`,
  );

  return {
    ...runtimeConfig,
    ...(mergedProvider ? { provider: mergedProvider } : {}),
    default_agent: runtimeConfig.default_agent ?? "openwork",
    agent: {
      openwork: {
        description: "OpenWork default agent",
        mode: "primary",
        temperature: 0.2,
        prompt: OPENWORK_AGENT_PROMPT,
      },
    },
    plugin: plugins,
    ...(disabledProviders.length ? { disabled_providers: disabledProviders } : {}),
    mcp: mcps,
  };
}

/**
 * Rough prompt-token cost estimate of the configured plugin + MCP tool
 * surface. Each plugin's tool definition block is ~500-1500 tokens depending
 * on schema complexity; this is a coarse heuristic (multiplier) used only
 * for operator log lines, not for any real billing.
 */
function estimatePluginTokenCost(
  plugins: unknown[],
  mcps: Record<string, unknown>,
): number {
  const pluginTokens = plugins.length * 800;
  const mcpTokens = Object.keys(mcps).length * 1200;
  return pluginTokens + mcpTokens;
}

export async function buildOpenworkRuntimeConfig(config?: ServerConfig, workspaceId?: string): Promise<string> {
  return JSON.stringify(await buildOpenworkRuntimeConfigObject(config, workspaceId));
}

export function openworkRuntimeConfigFilePath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "runtime-opencode-config.json");
}

// Serialize file writes per path so a slow older write can never land after
// (and clobber) a newer one. Content is built inside the queued job so each
// job reads the latest runtime-DB state.
const fileWriteQueue = new Map<string, Promise<void>>();

/**
 * Rebuild the engine-visible runtime config file from the runtime DB.
 * Atomic (temp file + rename) so the engine never reads a partial file
 * mid-dispose.
 */
export async function writeOpenworkRuntimeConfigFile(config: ServerConfig, workspaceId: string): Promise<string> {
  const path = openworkRuntimeConfigFilePath(config);
  const job = async () => {
    const content = await buildOpenworkRuntimeConfig(config, workspaceId);
    await mkdir(runtimeStorageDir(config), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, path);
  };
  const previous = fileWriteQueue.get(path) ?? Promise.resolve();
  const next = previous.then(job, job);
  fileWriteQueue.set(path, next);
  await next;
  return path;
}

/**
 * Keep the runtime config file in sync with the runtime DB so every engine
 * instance rebuild reads fresh state instead of a spawn-time snapshot.
 * Returns an unsubscribe function.
 */
export function keepOpenworkRuntimeConfigFileFresh(config: ServerConfig, workspaceId: string): () => void {
  return onRuntimeOpencodeConfigWrite((writeConfig, writtenWorkspaceId) => {
    if (writtenWorkspaceId !== workspaceId) return;
    void writeOpenworkRuntimeConfigFile(writeConfig, workspaceId).catch(() => undefined);
  });
}
