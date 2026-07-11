---
name: drawio-azure
description: Use when the user asks for an Azure architecture diagram — hub-spoke landing zone, Virtual WAN, hub-VNet peering, App Service + Functions, AKS, SQL/Storage, CAF-aligned topology, or any diagram built with Azure service icons. Builds with the declarative drawio-ai layout engine using ground-truth Azure stencils, validates, runs a render-based vision self-check. Default output is .drawio; PNG/SVG only on request.
version: 1.0.0
license: MIT
upstream: sparklabx/drawio-ai-kit@v1.0.0 (814d97e)
category: office-diagrams
agent: drawio-architect
---

# drawio-azure (OpenWork)

Produce correct Azure architecture diagrams in draw.io.

The deterministic engine, validator, icon catalog (626 Azure icons) and rules
live in the upstream `drawio-ai-kit` package. This skill is a thin frontend
that drives the build → validate → render → vision-self-check loop.

## 0. Preflight — CLI must be installed

```bash
command -v drawio-ai >/dev/null 2>&1 \
  || node "${OPENWORK_ROOT}/scripts/drawio-doctor.mjs"
```

Never run `npm i -g` yourself. Surface the install command from the doctor.

## 1. Load shared workflow + Azure rules

```bash
drawio-ai workflow
drawio-ai principles --mode azure
```

## 2. Build with the declarative engine

Same pattern as `drawio-aws`. The wrapper sets `DRAWIO_AI_KIT_ROOT`,
`DRAWIO_OUT`, `DRAWIO_NAME` for the build script. Diagram topology types:
`pipeline`, `hierarchy`, `network`, `hubspoke`, `hybrid`, `mesh`, `sequence`.

For inspiration, the kit ships Azure templates under
`${DRAWIO_AI_KIT_ROOT}/examples/azure/` (VNet N-tier, CAF hub-spoke landing
zone, etc.) — read them, do not hand-copy XML.

## 3. Validate

```bash
drawio-ai validate <file>.drawio
```

Hard-stops on unknown stencil IDs, dangling edges, missing `aspect=fixed`,
recolored Azure icons, broken group nesting, geometry issues.

## 4. Render + vision self-check

```bash
drawio-ai render <file>.drawio -o <file>.png
```

`Read` the PNG and verify every icon rendered, labels are legible, arrows
attach on icon edges, color palette matches Azure conventions.

## 5. Write to the user's project

Write the `.drawio` to `<user-project>/diagrams/azure/<name>.drawio`.

## Container nesting (authoritative order — CAF-aligned)

```
Azure (subscription boundary)
└── Management Group
    └── Subscription
        └── Resource Group
            └── Virtual Network
                └── Subnet
                    └── NSG
```

Hub-spoke: hub VNet hosts shared services (Firewall, Bastion, DNS, Key Vault);
spoke VNets peer to the hub. Use `group_azure_vnet` and peer with `link()`.

## Self-check before delivering

- [ ] Built with the layout engine — no hand-written coordinates.
- [ ] `drawio-ai validate` exits clean.
- [ ] Every icon came from `drawio-ai search`.
- [ ] `drawio-ai render` vision self-check passed.
- [ ] Output written under the user's project.
- [ ] Diagram title matches the user's ask.

## When NOT to use this skill

- AWS / GCP / Databricks / BPMN requests → use the corresponding `drawio-*` skill.
- Simple flowchart / sequence / class → use `beautiful-mermaid`.