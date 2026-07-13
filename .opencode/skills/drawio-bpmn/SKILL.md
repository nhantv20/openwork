---
name: drawio-bpmn
description: "Use when the user asks for a BPMN process diagram — pool + lanes, phases, swimlanes, gateways (exclusive/parallel/event-based), events (start/intermediate/end), tasks, message flows, sequence flows. Builds with the declarative drawio-ai layout engine using ground-truth BPMN stencils, validates, runs a render-based vision self-check. Default output is .drawio; PNG/SVG only on request."
version: 1.0.0
license: MIT
upstream: sparklabx/drawio-ai-kit@v1.0.0 (814d97e)
category: office-diagrams
agent: drawio-architect
---

# drawio-bpmn (OpenWork)

Produce correct BPMN 2.0 process diagrams in draw.io.

The deterministic engine, validator, BPMN icon catalog and rules live in the
upstream `drawio-ai-kit` package. This skill is for **structured business
process flows with lanes / gateways / events** — not for casual flowcharts.

> **Note**: for simple, single-path flowcharts / sequence / class diagrams,
> `beautiful-mermaid` is lighter. Use this skill when the user explicitly
> wants BPMN semantics (pools, lanes, gateways, events) or a swimlane
> layout.

## 0. Preflight — CLI must be installed

```bash
command -v drawio-ai >/dev/null 2>&1 \
  || node "${OPENWORK_ROOT}/scripts/drawio-doctor.mjs"
```

## 1. Load shared workflow + BPMN rules

```bash
drawio-ai workflow
drawio-ai principles --mode bpmn
```

## 2. Build with the declarative engine

The wrapper sets `DRAWIO_AI_KIT_ROOT`, `DRAWIO_OUT`, `DRAWIO_NAME` for the
build script. Use `bpmn` as the topology type (`new Diagram("bpmn")`).

For inspiration, the kit ships a BPMN template under
`${DRAWIO_AI_KIT_ROOT}/examples/bpmn/build_bpmn.mjs` (pool → lanes × phases).
Read it; do not hand-copy XML.

## 3. Validate

```bash
drawio-ai validate <file>.drawio
```

BPMN-specific checks:

- Every gateway has matching incoming + outgoing sequence flows.
- Start event has no incoming, end event has no outgoing.
- Message flows cross pools; sequence flows stay within a pool.
- Lanes have at least one task or sub-process.

## 4. Render + vision self-check

```bash
drawio-ai render <file>.drawio -o <file>.png
```

`Read` the PNG. Verify:

- Pool + lane labels are aligned (top-left corner).
- Gateways render as diamonds with the correct marker inside (× for parallel,
  ◇ for exclusive, ○ for event-based).
- Events render as circles (○ thin = intermediate, ● thick = start, ◉ double
  = end).
- Sequence flows have arrowheads; message flows have dashed lines.

## 5. Write to the user's project

Write the `.drawio` to `<user-project>/diagrams/bpmn/<name>.drawio`.

## Container nesting (authoritative order — BPMN)

```
Pool (process / participant)
└── Lane (role / system)
    └── Task / Sub-Process / Gateway / Event
```

A pool = a participant. A lane = a role within a participant. Tasks live in
lanes, not in pools directly.

## Self-check before delivering

- [ ] Built with the layout engine — no hand-written coordinates.
- [ ] `drawio-ai validate` exits clean.
- [ ] Every icon came from `drawio-ai search`.
- [ ] `drawio-ai render` vision self-check passed.
- [ ] Output written under the user's project.
- [ ] Diagram title matches the user's ask.

## When NOT to use this skill

- AWS / Azure / GCP / Databricks requests → use the corresponding `drawio-*`
  skill.
- Simple flowcharts without BPMN semantics (no pools/lanes/gateways) → use
  `beautiful-mermaid` (lighter, faster).