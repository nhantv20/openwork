# OpenWork — FPT Cloud AI Setup Guide

This guide explains how to set up **FPT Cloud AI** (Qwen3.6-27B, DeepSeek-V4-Flash)
after installing OpenWork.

## How It Works

- OpenWork reads **`FPT_API_KEY`** from **Settings → Environment** variables.
- If `FPT_API_KEY` is set, the FPT provider is automatically injected into every
  workspace — no config files or scripts needed.
- Optionally set **`FPT_CONFIG`** as a JSON string to customize models / base URL.

## Setup Instructions

### 1. Get an FPT Cloud AI API Key

Contact FPT Cloud to obtain an API key for their AI inference platform.

### 2. Add Environment Variables

1. Open **Settings** → **Environment**
2. Click **Add variable**
3. Add these variables:

| Key | Value | Required |
|---|---|---|
| `FPT_API_KEY` | `your-api-key-here` | ✅ Yes |
| `FPT_CONFIG` | `{ "models": { ... }, "baseURL": "..." }` | Optional |
| `FPT_PROXY_BASE_URL` | `http://127.0.0.1:8789/v1` | Optional — overrides `FPT_CONFIG.baseURL`. Point at a local proxy (e.g. `scripts/fpt-proxy`) for rate-limit observation. |
| `FPT_LIGHT_MODE` | `1` | Optional — drop heavy opencode-internal plugins + all MCPs to lower per-request prompt token cost. Useful when FPT rate-limits on TPM. |
| `FPT_DISABLE_PLUGINS` | `linear,figma` | Optional — comma-separated plugin names to exclude (substring match). |
| `FPT_DISABLE_MCPS` | `linear,figma` | Optional — comma-separated MCP names to exclude (substring match). |

4. Click **Apply Changes** to restart the engine

### 3. Select a Model

Open any session → click the **model picker** → you should see **FPT Cloud**
with two default models:

- **Qwen3.6-27B**
- **DeepSeek-V4-Flash**

Select one and start chatting.

---

## Customizing Models (`FPT_CONFIG`)

To add or remove models, set `FPT_CONFIG` as a JSON string:

```json
{
  "models": {
    "Qwen3.6-27B": { "name": "Qwen3.6-27B" },
    "DeepSeek-V4-Flash": { "name": "DeepSeek-V4-Flash" }
  },
  "baseURL": "https://mkp-api.fptcloud.com/v1"
}
```

- **`models`** — replaces the default model list entirely (add or remove freely)
- **`baseURL`** — optional, defaults to `https://mkp-api.fptcloud.com/v1`

Ví dụ thêm model mới:

```json
"models": {
  "Qwen3.6-27B": { "name": "Qwen3.6-27B" },
  "DeepSeek-V4-Flash": { "name": "DeepSeek-V4-Flash" },
  "Model-Mới": { "name": "Model-Mới" }
}
```

After changing `FPT_CONFIG`, click **Apply Changes** in Settings → Environment.

---

## Building the Windows Installer

**Requirements:**
- Windows build machine
- Node.js 24
- pnpm 11.4.0
- Bun >= 1.3.10
- Visual Studio Build Tools

**Command:**

```bash
pnpm --filter @openwork/desktop package:electron
```

The `.exe` installer will be at `apps/desktop/dist-electron/openwork-win-x64-<version>.exe`.