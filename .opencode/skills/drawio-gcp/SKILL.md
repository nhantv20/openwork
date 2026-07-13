---
name: drawio-gcp
description: "Use when the user asks for a GCP architecture diagram — VPC, Shared VPC landing zone, GKE, Cloud Run, Cloud SQL, Cloud Storage, Interconnect, PSC, VPC-SC, or any diagram built with Google Cloud service icons. Builds with the declarative drawio-ai layout engine using ground-truth GCP stencils, validates, runs a render-based vision self-check. Default output is .drawio; PNG/SVG only on request."
version: 1.0.0
license: MIT
upstream: sparklabx/drawio-ai-kit@v1.0.0 (814d97e)
category: office-diagrams
agent: drawio-architect
---

# drawio-gcp (OpenWork)

Produce correct GCP architecture diagrams in draw.io.

The deterministic engine, validator, icon catalog (216 GCP icons) and rules
live in the upstream `drawio-ai-kit` package. This skill is a thin frontend
that drives the build → validate → render → vision-self-check loop.

## 0. Preflight — CLI must be installed

```bash
command -v drawio-ai >/dev/null 2>&1 \
  || node "${OPENWORK_ROOT}/scripts/drawio-doctor.mjs"
```

## 1. Load shared workflow + GCP rules

```bash
drawio-ai workflow
drawio-ai principles --mode gcp
```

## 2. Build with the declarative engine

The wrapper sets `DRAWIO_AI_KIT_ROOT`, `DRAWIO_OUT`, `DRAWIO_NAME` for the
build script. Diagram topology types: `pipeline`, `hierarchy`, `network`,
`hubspoke`, `hybrid`, `mesh`, `sequence`.

For inspiration, the kit ships GCP templates under
`${DRAWIO_AI_KIT_ROOT}/examples/gcp/` (global VPC across two regions, Shared
VPC landing zone with host/service projects, regional Cloud Router/NAT,
Interconnect, PSC, VPC-SC) — read them, do not hand-copy XML.

## 3. Validate

```bash
drawio-ai validate <file>.drawio
```

## 4. Render + vision self-check

```bash
drawio-ai render <file>.drawio -o <file>.png
```

`Read` the PNG and verify every icon rendered, labels are legible, arrows
attach on icon edges, color palette matches GCP conventions.

## 5. Write to the user's project

Write the `.drawio` to `<user-project>/diagrams/gcp/<name>.drawio`.

## Container nesting (authoritative order)

```
Organization
└── Folder (optional)
    └── Project
        └── VPC (global) or Subnetwork (regional)
            └── ...
```

Shared VPC: host project owns the VPC; service projects attach via
`shared-vpc-host` / `service-project` associations.

## Self-check before delivering

- [ ] Built with the layout engine — no hand-written coordinates.
- [ ] `drawio-ai validate` exits clean.
- [ ] Every icon came from `drawio-ai search`.
- [ ] `drawio-ai render` vision self-check passed.
- [ ] Output written under the user's project.
- [ ] Diagram title matches the user's ask.

## When NOT to use this skill

- AWS / Azure / Databricks / BPMN requests → use the corresponding `drawio-*` skill.
- Simple flowchart / sequence / class → use `beautiful-mermaid`.