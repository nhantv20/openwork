---
name: antifact
description: Manage HTML artifacts — create, update, list, delete, and serve via built-in web server
category: generic
---

# Antifact — Artifact Manager

Manage HTML artifacts published through the `publish_artifact` tool. Artifacts are HTML pages served at `http://127.0.0.1:26316/` via a built-in web server.

## Commands

### `/antifact create <title>`
Create a new artifact. You provide the HTML content. The artifact is saved and served at `http://127.0.0.1:26316/<title>.html`.

### `/antifact update <title>`
Update an existing artifact by publishing new HTML content to the same title. The URL stays the same.

### `/antifact list`
List all published artifacts with their URLs, sizes, and last modified times.

### `/antifact delete <title>`
Delete an artifact file from the server.

### `/antifact info <title>`
Show details about a specific artifact: URL, size, last modified, content preview.

### `/antifact serve <directory>`
Start serving a custom directory as static files (useful for sharing multiple files).

## How it works

- The artifact-publisher plugin provides `publish_artifact` and `list_artifacts` tools.
- A built-in HTTP server runs at `http://127.0.0.1:26316` serving the `artifacts/` directory.
- Publishing with the same title overwrites the existing file (live update).
- The artifact panel in OpenWork also auto-detects artifact files from agent responses.

## Examples

```
/antifact create daily-news
→ Agent fetches news, generates HTML, publishes to http://127.0.0.1:26316/daily-news.html

/antifact list
→ Lists all artifacts with URLs and details

/antifact update daily-news
→ Fetches fresh news, overwrites the same URL

/antifact delete old-report
→ Removes old-report.html from the server
```