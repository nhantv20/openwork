---
name: drawio-databricks
description: Use when the user asks for a Databricks architecture diagram — Lakehouse (medallion: Bronze/Silver/Gold), Data Intelligence Platform, MLOps with workspaces, Unity Catalog, Delta Sharing, Mosaic AI, control-plane vs data-plane, or any diagram built with Databricks icons. Builds with the declarative drawio-ai layout engine, validates, runs a render-based vision self-check. Default output is .drawio; PNG/SVG only on request.
version: 1.0.0
license: MIT
upstream: sparklabx/drawio-ai-kit@v1.0.0 (814d97e)
category: office-diagrams
agent: drawio-architect
---

# drawio-databricks (OpenWork)

Produce correct Databricks architecture diagrams in draw.io.

The deterministic engine, validator, icon catalog (24 Databricks icons +
union of AWS/Azure/GCP catalogs) and rules live in the upstream
`drawio-ai-kit` package.

## 0. Preflight — CLI must be installed

```bash
command -v drawio-ai >/dev/null 2>&1 \
  || node "${OPENWORK_ROOT}/scripts/drawio-doctor.mjs"
```

## 1. Load shared workflow + Databricks rules

```bash
drawio-ai workflow
drawio-ai principles --mode databricks
```

## 2. Build with the declarative engine

The wrapper sets `DRAWIO_AI_KIT_ROOT`, `DRAWIO_OUT`, `DRAWIO_NAME` for the
build script. Diagram topology types: `pipeline`, `hierarchy`, `network`,
`hybrid`, `mesh`, `sequence`.

For inspiration, the kit ships Databricks templates under
`${DRAWIO_AI_KIT_ROOT}/examples/databricks/`:

| Template | Topology |
| -------- | -------- |
| `build_lakehouse.mjs`                   | pipeline (medallion Bronze/Silver/Gold) |
| `build_platform.mjs`                    | hybrid (control-plane vs data-plane)   |
| `build_data_intelligence_platform.mjs`   | pipeline (signature bands + medallion) |
| `build_mlops.mjs`                       | pipeline (Git + Dev/Staging/Prod workspaces + Unity Catalog + Lakehouse) |

Read them; do not hand-copy XML.

## 3. Validate

```bash
drawio-ai validate <file>.drawio
```

## 4. Render + vision self-check

```bash
drawio-ai render <file>.drawio -o <file>.png
```

`Read` the PNG. Verify medallion bands render correctly, Unity Catalog
appears once, no icon duplication.

## 5. Write to the user's project

Write the `.drawio` to `<user-project>/diagrams/databricks/<name>.drawio`.

## Container nesting (authoritative order — Databricks)

```
Workspace
└── Metastore (Unity Catalog)
    └── Catalog
        └── Schema
            └── Table / Volume / Function
```

For cloud-anchored Databricks deployments, nest under the relevant cloud
(`group_aws_cloud_alt`, `group_azure`, etc.) and place the Workspace inside
the data-plane.

## Self-check before delivering

- [ ] Built with the layout engine — no hand-written coordinates.
- [ ] `drawio-ai validate` exits clean.
- [ ] Every icon came from `drawio-ai search`.
- [ ] `drawio-ai render` vision self-check passed.
- [ ] Output written under the user's project.
- [ ] Diagram title matches the user's ask.

## When NOT to use this skill

- AWS / Azure / GCP / BPMN requests → use the corresponding `drawio-*` skill.
- Simple flowchart / sequence / class → use `beautiful-mermaid`.