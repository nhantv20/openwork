---
name: use-asset
description: Resolve, read, write, and search assets in the current workspace via the asset:// URI scheme.
when: When the user references a file, template, brand shell, image, or other asset that should be addressed by stable ID rather than absolute path.
---

# Use Asset

The Asset Library stores versioned payloads (file, bundle, text) under stable IDs and exposes them via `asset://<scope>/<ns>/<name>[@<version>][#<file>]`. Scopes: `workspace`, `local`, `org`, `hub`.

## Tools

- `openwork_list_assets` — discover what's available (filter by scope/tag/mime/kind).
- `openwork_search_assets` — substring search across manifest fields.
- `openwork_read_asset` — get manifest + content (text), bytes (file), or one file from a bundle.
- `openwork_resolve_asset` — batch-resolve a list of `asset://` URIs in one call.
- `openwork_write_asset` — create or bump a version. Goes through user approval upstream.

## Pattern

1. Run `openwork_list_assets` (or `openwork_search_assets`) to find candidates.
2. Prefer `asset://workspace/...` references in your final response; do not embed raw bytes for binary assets unless the user explicitly asks.
3. For text/JSON assets you need to read now, call `openwork_read_asset` and use the returned `content` directly.
4. For bundle assets, address the specific file with `#path` in the URI (URL-encode spaces: `%20`).
5. `openwork_write_asset` always requires user approval — never silently bump versions.

## Token economics

Calling `openwork_read_asset` returns both the manifest and the payload. Each manifest is small, but large text files can be expensive. Prefer:
- `openwork_list_assets` first to confirm existence.
- `openwork_resolve_asset` when you have a list of references (one round-trip).
- For binary assets, do not inline `bytes` in your response — emit the `asset://` URI instead and let the rendering pipeline fetch it.

## Versioning

- `@<version>` is semver-loose: `@2` matches `2.x.x`, `2.0` matches `2.0.x`, exact otherwise.
- `@latest` (or omitted) selects the pointer file.
- New versions never overwrite; the bump auto-increments patch by default unless you pass `version` or change `kind` (major bump).

## Safety

- Asset paths must not contain `..`, reserved characters, or the names `manifest.json` / `latest` / `.lock`.
- Max sizes: text 1 MB, file 50 MB, bundle 200 MB. Adjust via `AssetStorageOptions`.
- Mark sensitive assets with the `secret` tag — they will be redacted by `openwork_assets_export`.

See `apps/server/src/assets.ts` for the canonical implementation.
