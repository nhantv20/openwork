# fpt-proxy — local pass-through proxy for FPT Cloud AI

## Why

`mkp-api.fptcloud.com` (FPT Cloud AI) returns **429 too many request** when
called via OpenWork / opencode, but a direct test script is fine. Suspect
reasons:

1. opencode's `@ai-sdk/openai-compatible` retries 429s automatically — each
   real 429 becomes 3-4 actual requests, which keeps tripping FPT's limit.
2. opencode's agent loop may parallelize tool calls, causing concurrent
   spikes that a sequential script never produces.
3. FPT may rate-limit per token, not per request — long agent prompts burn
   TPM faster than a one-liner test.

The proxy sits in front of FPT, **logs every request**, **counts tokens**
(both estimated prompt and reported `usage`), and applies a **token-bucket
throttle (RPM + TPM)** so we can either observe what opencode is doing
without burning the quota, or hard-limit it.

## Install

No external deps — uses Bun's built-in `bun:sqlite`. Just need Bun ≥ 1.3.

## Run

```bash
FPT_API_KEY=sk-... ./scripts/fpt-proxy/start.sh
```

Output:

```
[fpt-proxy] port=8789 db=.../proxy.db rpm=30 tpm=200000 upstream=https://mkp-api.fptcloud.com
[fpt-proxy] dashboard: http://127.0.0.1:8789/__dashboard
[fpt-proxy] point FPT_CONFIG at: {"baseURL":"http://127.0.0.1:8789/v1"}
```

Env vars (all optional):

| Var | Default | What |
|---|---|---|
| `FPT_API_KEY` | — | Required. Forwarded as `Authorization: Bearer …` to FPT. |
| `FPT_PROXY_PORT` | `8789` | Port to listen on. |
| `FPT_PROXY_DB` | `scripts/fpt-proxy/proxy.db` | SQLite log path. |
| `FPT_PROXY_RPM` | `30` | Requests per minute cap. |
| `FPT_PROXY_TPM` | `200000` | Tokens per minute cap (estimated + reported). |
| `FPT_PROXY_BURST` | `5` | Reserved for future smoothing (currently unused). |
| `FPT_UPSTREAM` | `https://mkp-api.fptcloud.com` | Override FPT base URL. |
| `FPT_PROXY_RESET` | `0` | Set to `1` to wipe the SQLite log on start. |

## Point OpenWork at it

In OpenWork **Settings → Environment**:

| Key | Value |
|---|---|
| `FPT_API_KEY` | your key (unchanged) |
| `FPT_CONFIG`  | `{"baseURL":"http://127.0.0.1:8789/v1"}` |

Click **Apply Changes** to restart the engine. opencode now talks to the
proxy, which forwards to FPT.

The proxy URL is intentionally `http://127.0.0.1:8789/v1` so it matches the
`/v1` path FPT expects — `Authorization` header is forwarded as-is, so the
real key never leaves your machine.

## Endpoints

| Method | Path | What |
|---|---|---|
| * | `/v1/*` | Pass-through to `FPT_UPSTREAM` (same path). |
| GET | `/__health` | `ok` |
| GET | `/__stats` | JSON counters + recent 20 rows + current config. |
| POST | `/__config` | `{rpm, tpm, burst}` — update throttle live. |
| POST | `/__reset` | Wipe `requests` table + reset in-memory window. |
| GET | `/__dashboard` | HTML page (auto-refresh every 2s). |

When throttled, the proxy returns a normal `429` with body
`{"error":{"message":"local throttle: too many requests, retry after Ns",
"type":"rate_limit_error","code":"throttled"}}` and a `retry-after` header —
so opencode / AI SDK can treat it the same as a real 429 (and won't escalate
in any surprising way).

## Read the dashboard

`http://127.0.0.1:8789/__dashboard` shows:

- **Reqs (60s) / Tokens (60s)** — current window usage vs limit.
- **By model (60s)** — which FPT model opencode is actually hitting and how
  much. Critical signal: if you see e.g. 5x more requests than expected per
  user message, that confirms the retry-amplification hypothesis.
- **Recent 20 requests** — status, model, prompt/completion/total tokens,
  upstream status, error.

## Test the proxy

```bash
# in another terminal, after starting the proxy
FPT_API_KEY=sk-... bun scripts/fpt-proxy/test.ts
```

Runs pass-through + stats + throttle tests. Exit code 0 on success.

## Interpreting the data

The openwork FPT provider config ([`apps/server/src/openwork-runtime-config.ts`](../../apps/server/src/openwork-runtime-config.ts))
uses `models: { "Qwen3.6-27B": ..., "DeepSeek-V4-Flash": ... }` with the
`@ai-sdk/openai-compatible` provider. If the dashboard shows:

- **Many more requests than user messages** — AI SDK retry on 429 confirmed.
  → Lower `FPT_PROXY_RPM` to your real quota, problem solved.
- **Huge `total_tokens` per request** — model picks up the whole conversation
  history each turn. → Shorten context in opencode agent prompt or switch
  model.
- **Many 429s from upstream (status = 429, upstream_status = 429)** — FPT is
  actually rate-limiting; the proxy didn't catch it in time. → Lower
  `FPT_PROXY_RPM` to e.g. 50% of the FPT limit.
- **Zero 429s, all upstream_status = 200** — FPT is fine; the original 429s
  opencode reported were likely transient. → Look at opencode's own retry
  config (might be a known Vercel AI SDK issue with this provider).
