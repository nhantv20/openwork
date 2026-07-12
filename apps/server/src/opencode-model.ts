/**
 * OpenCode SDK result helpers (Phase 3 / M2).
 *
 * Small utilities shared by the scheduled runner, the model-list
 * route, and the per-workspace client wrapper. Keeping them here
 * means the runner and the UI route agree on the shape of
 * `Config.model` and `Config.providers()` — and we only have one
 * place to update if OpenCode adds a third fallback (e.g. an
 * `agent`-scoped default).
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Shape of `Config.model` after `await client.config.get()`. The SDK
 *  wraps the result as `{ data, error, response }`; we normalise that
 *  here so callers don't repeat the dance. */
export type OpencodeConfigModel = string | null;

type ProviderLike = {
  id?: unknown;
  name?: unknown;
  models?: unknown;
};

type ProvidersResponse = {
  providers?: unknown;
  default?: unknown;
};

/** Best-effort lookup of the workspace's default model. Mirrors the
 *  order the OpenCode TUI itself uses: explicit `Config.model` →
 *  per-provider `default[providerID]` → first provider's first model.
 *  Returns null when no usable model is found.
 *
 *  Accepts any object that exposes the SDK methods we need so the
 *  route, the wrapper, and the tests can all share this. */
export async function resolveDefaultModel(
  sdk: {
    config?: {
      get?: () => Promise<unknown>;
      providers?: () => Promise<unknown>;
    };
  },
): Promise<OpencodeConfigModel> {
  // 1) Workspace-wide `Config.model`.
  if (sdk.config?.get) {
    try {
      const result = await sdk.config.get();
      const data = isRecord(result) ? result.data : undefined;
      if (isRecord(data)) {
        const model = data.model;
        if (typeof model === "string" && model.trim()) return model.trim();
      }
    } catch {
      // fall through
    }
  }
  // 2) Provider catalog default.
  if (sdk.config?.providers) {
    try {
      const result = await sdk.config.providers();
      const data = isRecord(result) ? result.data : undefined;
      if (isRecord(data)) {
        const all = Array.isArray(data.providers)
          ? (data.providers as ProviderLike[])
          : [];
        const defaultMap = isRecord(data.default) ? data.default : {};
        for (const [providerID, modelID] of Object.entries(defaultMap)) {
          if (typeof modelID === "string" && modelID.trim()) {
            return `${providerID}/${modelID}`;
          }
        }
        for (const provider of all) {
          if (!isRecord(provider)) continue;
          const providerID = String(provider.id ?? "").trim();
          if (!providerID) continue;
          const models = isRecord(provider.models) ? provider.models : {};
          const firstModelID = Object.keys(models)[0];
          if (firstModelID) {
            return `${providerID}/${firstModelID}`;
          }
        }
      }
    } catch {
      // fall through
    }
  }
  return null;
}

export type ModelOption = {
  value: string;
  label: string;
  providerLabel: string;
  isDefault: boolean;
};

/** Pull every `(providerID, modelID)` pair out of the providers
 *  response, mark the workspace's default, and sort with the default
 *  first. Returns an empty array on any failure. */
export async function listProviderModels(
  sdk: {
    config?: {
      get?: () => Promise<unknown>;
      providers?: () => Promise<unknown>;
    };
  },
): Promise<{ models: ModelOption[]; defaultModel: OpencodeConfigModel }> {
  const models: ModelOption[] = [];
  const defaultModel = await resolveDefaultModel(sdk);

  if (!sdk.config?.providers) {
    return { models, defaultModel };
  }
  try {
    const result = await sdk.config.providers();
    if (!isRecord(result)) return { models, defaultModel };
    const data = isRecord(result.data) ? (result.data as ProvidersResponse) : null;
    if (!data) return { models, defaultModel };
    const all = Array.isArray(data.providers)
      ? (data.providers as ProviderLike[])
      : [];
    const defaultMap = isRecord(data.default) ? data.default : {};
    for (const provider of all) {
      if (!isRecord(provider)) continue;
      const providerID = String(provider.id ?? "").trim();
      if (!providerID) continue;
      const providerName = String(provider.name ?? providerID);
      const providerModels = isRecord(provider.models)
        ? (provider.models as Record<string, unknown>)
        : {};
      for (const [modelID, def] of Object.entries(providerModels)) {
        if (!modelID) continue;
        const modelDef = isRecord(def) ? def : null;
        const modelName = modelDef && typeof modelDef.name === "string" ? modelDef.name : modelID;
        const value = `${providerID}/${modelID}`;
        const isDefault =
          String((defaultMap as Record<string, unknown>)[providerID] ?? "") === modelID ||
          defaultModel === value;
        models.push({
          value,
          label: modelName,
          providerLabel: providerName,
          isDefault,
        });
      }
    }
  } catch {
    return { models, defaultModel };
  }
  models.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.providerLabel !== b.providerLabel) {
      return a.providerLabel.localeCompare(b.providerLabel);
    }
    return a.label.localeCompare(b.label);
  });
  return { models, defaultModel };
}
