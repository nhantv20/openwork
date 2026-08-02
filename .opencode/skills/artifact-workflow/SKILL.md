---
name: artifact-workflow
description: Create, publish, verify, and troubleshoot HTML artifacts via publish_artifact — robust against opencode sidecar cwd quirks, with copy-to-both-dirs fallback when artifact server returns 404.
category: generic
---

# Artifact Workflow — Create, Verify, Troubleshoot

Use this skill whenever a task ends with "create an HTML artifact", "publish", "build a dashboard/report/page", or whenever `publish_artifact` returns success but the browser shows 404.

## Quick recipe (most tasks)

1. **Build the HTML** (must include `<!DOCTYPE html>`, `<html>`, `<head>`, `<body>`).
2. **`publish_artifact(title, content, prompt)`** — title is kebab-case (e.g. `tech-news`, `daily-news`), `.html` is optional.
3. **Verify it actually serves** before reporting done:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:26316/<title>.html"
   # expect: 200
   ```

4. If `200` → report the URL to the user.
5. If `404` → run the **404 fallback** below before giving up.

## When `publish_artifact` returns success but the server returns 404

This is a known bug: `publish_artifact` writes via `nodePath.join(process.cwd(), "artifacts")`, while the artifact server reads from a different working directory depending on how opencode was launched (dev mode vs packaged app). On macOS the artifacts directories live under:

```
~/Library/Application Support/com.differentai.openwork.dev/managed-opencode-workdir/artifacts/                          ← publish_artifact writes here
~/Library/Application Support/com.differentai.openwork.dev/managed-opencode-workdir/managed-opencode-workdir/artifacts/   ← server reads from here (legacy bug)
~/project/openwork/artifacts/                                                                                          ← read/write tool writes here (NOT served)
```

### 404 fallback (run in order until the file 200s)

```bash
# 1. Probe
curl -s -o /dev/null -w "tech-news: %{http_code}\n" "http://127.0.0.1:26316/<title>.html"
curl -s   "http://127.0.0.1:26316/"   # see what server actually lists

# 2. If server is DEAD, restart it
SERVER_PID=$(lsof -ti :26316 2>/dev/null)
[ -n "$SERVER_PID" ] && kill -HUP $SERVER_PID
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:26316/"

# 3. Copy to BOTH possible artifact dirs (covers whichever cwd the server uses)
SCRATCH=/tmp/artifact-fallback
mkdir -p "$SCRATCH"

DEST1="/Users/trannhan/Library/Application Support/com.differentai.openwork.dev/managed-opencode-workdir/artifacts"
DEST2="/Users/trannhan/Library/Application Support/com.differentai.openwork.dev/managed-opencode-workdir/managed-opencode-workdir/artifacts"

# Republish via tool first (ensures meta.json is in sync), then copy file to the OTHER dir
publish_artifact title="<title>" content="..." prompt="..."
curl -s -o "$SCRATCH/<title>.html" "http://127.0.0.1:26316/<title>.html"   # may 404 — that's fine
# If server returned 200 above, the source file already lives in the right place; just copy it to the other dir
for d in "$DEST1" "$DEST2"; do
  cp "$SCRATCH/<title>.html" "$d/<title>.html" 2>/dev/null
  [ -f "$d/<title>.meta.json" ] || cp "$SCRATCH/<title>.meta.json" "$d/" 2>/dev/null
done

# 4. Verify
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:26316/<title>.html"
```

If still 404 after step 3, fully quit and reopen OpenWork (dev mode app) — its opencode sidecar rescans the artifacts dir on startup.

## Why this happens

Source: `.opencode/plugins/artifact-publisher.ts` (line 4 + 69):

```typescript
const ARTIFACTS_DIR = "artifacts"
...
const root = nodePath.join(process.cwd(), ARTIFACTS_DIR)
```

`process.cwd()` resolves to whichever directory opencode was launched from. In dev mode that can be the nested `managed-opencode-workdir/managed-opencode-workdir/` rather than the intended `managed-opencode-workdir/`. The HTTP server started by the same plugin uses the same `process.cwd()`, but the **OpenWork UI** reads from yet another location depending on how it spawned the sidecar, leading to the mismatch.

## Verification checklist (always run before reporting done)

| Check | Command | Expected |
|---|---|---|
| Tool reported success | `publish_artifact` returned without error | ✓ |
| File exists on disk | `ls ~/Library/Application Support/com.differentai.openwork.dev/managed-opencode-workdir*/artifacts/<title>.html` | exists |
| Server serves it | `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:26316/<title>.html"` | `200` |
| Listed by server | `curl -s "http://127.0.0.1:26316/"` | `<title>.html` appears |

Only when all four pass is the artifact actually live. If tool reports success but checks 2–4 fail, the cwd-mismatch fallback above will fix it.

## Other useful commands

```bash
# List everything the server actually knows about
curl -s "http://127.0.0.1:26316/" | grep -oE 'href="/[^"]+"' | sort -u

# Server status
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:26316/"   # 200 = up

# Force kill + respawn (the OpenWork dev mode app should respawn it automatically)
lsof -ti :26316 | xargs -r kill -HUP
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:26316/"
```

## When to skip this skill

- File-only outputs (markdown, csv, json) → just write them with the `write` tool to `/Users/trannhan/project/openwork/<dir>/<name>`.
- "Show me a preview" without persistence → just print the HTML; don't publish.
- The artifact is just a static `<file>artifacts/<name>.html</file>` for a fraimz / e2e proof → use the `write` tool; do NOT use `publish_artifact`.