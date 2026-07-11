# drawio-ai-kit version pin

OpenWork consumes the upstream `drawio-ai-kit` (MIT, sparklabx/drawio-ai-kit) as
a **runtime dependency** — it is **not** vendored into this repo (the catalog
JSON alone is ~20 MB and the upstream moves fast).

The kit is installed globally by the user via `npm`. This file pins the
exact version + commit SHA so every OpenWork build / agent / eval flow refers
to the same upstream source.

## Pin

| Field    | Value                                    |
| -------- | ---------------------------------------- |
| upstream | `https://github.com/sparklabx/drawio-ai-kit` |
| version  | `1.0.0`                                  |
| tag      | `v1.0.0`                                 |
| commit   | `814d97e46e81d0d7b85b30192cfbfefb281f8a03` |
| signed   | GitHub verified signature, key `B5690EEEBB952194` |
| released | 2026-07-10 04:00 UTC                     |
| author   | `@hungdo-sami`                           |
| license  | MIT (code) — see `THIRD_PARTY_NOTICES.md` in upstream for icon attribution |

## Install (user-initiated, never automatic)

```bash
npm i -g github:sparklabx/drawio-ai-kit#814d97e46e81d0d7b85b30192cfbfefb281f8a03
```

Or, from this repo, run the helper:

```bash
pnpm drawio:install
```

**The agent must never run `npm i -g` on the user's behalf** — global installs
mutate the user's environment. The agent's job is to *detect* missing CLI and
*print* the install command (see `scripts/drawio-doctor.mjs`).

## Verifying the pin

After install, the on-disk `package.json#version` must match. We check
`version` rather than `git rev-parse HEAD` because the kit's install root can
sit under a parent repo (e.g. `/opt/homebrew/lib/node_modules/`) where `git`
walks up to the wrong `.git/`.

```bash
DRAWIO_ROOT="$(drawio-ai root)"
cat "$DRAWIO_ROOT/package.json" | grep '"version"'   # → "version": "1.0.0"
```

`scripts/drawio-doctor.mjs` does this check for you. A version drift is a
breaking-change signal — update this PIN file and re-run
`evals/flows/drawio-aws-architecture.flow.mjs`.

## Why we trust this version

- MIT license, no `postinstall` hooks, no telemetry, no `sudo`, no `curl|bash`
  (per upstream SECURITY.md).
- Zero runtime dependencies since 1.0.0.
- Pinned to a **tagged commit**, not `main`.

## When to bump

| Bump | Trigger |
| ---- | ------- |
| patch | upstream fixes a bug we depend on |
| minor | upstream adds an icon pack / diagram type we want |
| major | upstream changes the CLI surface or removes a command we call |

Always bump **commit SHA first**, then `version`. Never bump version without
verifying the commit.