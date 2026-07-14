---
name: antifact
description: Manage HTML artifacts — create, update, list, delete, and serve via built-in web server
category: generic
---

# Antifact — Artifact Manager

Manage HTML artifacts published through the `publish_artifact` tool. Artifacts are HTML pages served at `http://127.0.0.1:26316/` via a built-in web server.

## Commands

### `/antifact create <title>`
Create a new artifact with HTML content. **Always ask for and save a `prompt`** — a short description of how to regenerate this artifact (e.g. "Fetch latest news from VnExpress RSS, format as HTML with sections"). The prompt is used by `/antifact update`.

### `/antifact update <title>`
Read the saved prompt for this artifact, then follow it to regenerate fresh content. The URL stays the same. Each update is logged in the artifact's history with timestamp and summary.

### `/antifact list`
List all published artifacts with URLs, sizes, last run times, and update counts.

### `/antifact delete <title>`
Delete an artifact (removes .html + .meta.json with history).

### `/antifact info <title>`
Show full details: URL, size, created/last run dates, update history (last 5), content preview, and saved prompt.

### `/antifact prompt <title> [new prompt]`
Read or update the regeneration prompt. Without arguments, shows the current prompt. Changes are tracked in history.

## Tracking

Every artifact stores a `.meta.json` alongside its `.html` with:

| Field | Description |
|---|---|
| `prompt` | How to regenerate this artifact |
| `createdAt` | When first published |
| `lastRunAt` | When last updated |
| `lastSize` | File size in bytes |
| `history` | Array of `{timestamp, summary}` — last 20 entries |

## Examples

```
/antifact create daily-news
→ Agent asks for prompt, saves it, publishes

/antifact list
→ Lists all artifacts with URLs, last run, update count

/antifact update daily-news
→ Reads saved prompt, regenerates, logs to history

/antifact info daily-news
→ Shows size, dates, history, preview, prompt

/antifact prompt daily-news
→ Shows: "Fetch latest news from VnExpress RSS..."

/antifact prompt daily-news "Fetch from different source"
→ Updates prompt, logs change in history

/antifact delete old-report
→ Removes .html + .meta.json
```