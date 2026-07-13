---
name: drawio-aws
description: "Use when the user asks for an AWS architecture diagram — VPC / networking, multi-AZ, event-driven, landing zone, serverless pipeline, IAM topology, or any diagram built with AWS service icons. Builds with the declarative drawio-ai layout engine using ground-truth mxgraph.aws4 stencils, validates, runs a render-based vision self-check. Default output is .drawio; PNG/SVG only on request."
version: 1.0.0
license: MIT
upstream: sparklabx/drawio-ai-kit@v1.0.0 (814d97e)
category: office-diagrams
agent: drawio-architect
---

# drawio-aws (OpenWork)

Produce correct AWS architecture diagrams in draw.io.

> **Agent:** this skill is registered with the **`drawio-architect`**
> sub-agent (`.opencode/agents/drawio-architect.md`) which owns the
> multi-step build → validate → render → vision-check workflow. The
> `office-assistant` agent delegates AWS / Azure / GCP / Databricks /
> BPMN requests to it.
>
> See `vendor/drawio-ai-kit.PIN.md` for the upstream pin.

The deterministic engine, validator, icon catalog (983 AWS icons) and rules
live in the upstream `drawio-ai-kit` package. This skill is a **thin
frontend** that:

1. Checks the CLI is installed.
2. Loads the AWS-specific domain rules.
3. Drives the build → validate → render → vision-self-check loop.
4. Writes the output under the user's project (never in the kit, never in `cwd`).

## 0. Preflight — CLI must be installed

```bash
command -v drawio-ai >/dev/null 2>&1 \
  || node "${OPENWORK_ROOT}/scripts/drawio-doctor.mjs"
```

The doctor script prints the exact install command for the pinned commit if
the CLI is missing. **Never run `npm i -g` yourself** — that mutates the
user's global environment; surface the command and let them run it.

You may also use the OpenWork helper:

```bash
pnpm drawio:doctor    # prints status + install hint
pnpm drawio:install   # ONLY if the user explicitly asked to install
```

## 1. Load the shared workflow

```bash
drawio-ai workflow
```

This prints the canonical build → validate → render → write loop. Read it;
it is the source of truth.

## 2. Load AWS domain rules

```bash
drawio-ai principles --mode aws
```

Returns AWS rules + shared principles + catalog categories.

## 3. Build with the declarative engine

When using `pnpm drawio:aws:build` (or `scripts/drawio-aws-build.mjs`), the
wrapper sets these env vars for the build script:

| Var | Meaning |
| --- | ------- |
| `DRAWIO_AI_KIT_ROOT` | absolute path to the installed kit (= `drawio-ai root`) |
| `DRAWIO_OUT`         | absolute path where the `.drawio` file should be written |
| `DRAWIO_NAME`        | the diagram name (matches `--name`) |

The build script is a plain Node ESM file that imports the engine by absolute
path:

```js
import { writeFileSync } from "node:fs";
import { Diagram } from `${process.env.DRAWIO_AI_KIT_ROOT}/src/builder.mjs`;
import { group, icon, renderTree } from `${process.env.DRAWIO_AI_KIT_ROOT}/src/layout-engine.mjs`;

const d = new Diagram("network");
// ... build topology with group() / icon() / renderTree() ...
renderTree(d, tree);
const out = `${process.env.DRAWIO_OUT}`;
writeFileSync(out, d.mxfile(process.env.DRAWIO_NAME));
console.log(`wrote ${out}`);
```

Build with the declarative layout engine (**NO hand-written coordinates**).
Diagram topology types: `pipeline`, `hierarchy`, `network`, `hubspoke`,
`hybrid`, `mesh`, `sequence`.

For inspiration, the kit ships 14 AWS templates under
`${DRAWIO_AI_KIT_ROOT}/examples/aws/` (VPC, multi-AZ, EKS, EFS, event-driven,
serverless, landing zone, IAM topology, etc.) — read them, do not hand-copy XML.

## 4. Validate

```bash
drawio-ai validate <file>.drawio
```

Hard-stops on:

- unknown stencil IDs (agent fabricated a name)
- dangling edges
- missing `aspect=fixed`
- recolored AWS icons (categories own the colors — never override)
- broken AWS group nesting (`AWS Cloud → Region → VPC → AZ → Subnet → SG`)
- geometry issues (overlap, child spilling its frame, stacked arrowheads)

Soft-warns on aesthetic issues (font, palette, fan-out, icon-size).

## 5. Render + vision self-check

```bash
drawio-ai render <file>.drawio -o <file>.png
```

Then `Read` the PNG and verify:

- every icon rendered (no empty rectangles — a sign of a bad stencil ID the
  validator somehow missed)
- labels are legible
- arrows attach on icon edges, not in space
- color palette matches AWS conventions

If any check fails, fix the build, re-validate, re-render. Do **not** deliver
a diagram that fails the vision check.

## 6. Write to the user's project

Write the `.drawio` (and optionally `.png`) to an **absolute path under the
user's project**, never into the kit install dir, never into the agent cwd
unless the cwd IS the user's project.

Suggested layout:

```
<user-project>/diagrams/aws/<name>.drawio
<user-project>/diagrams/aws/<name>.png
```

## 7. Hand-off to downstream skills

The PNG output is the bridge to other skills:

- **Slide deck** → hand the PNG to `morph-ppt` as an "architecture block"
  (see `morph-ppt/SKILL.md` § Architecture blocks). Provide the absolute
  path; morph-ppt will inline it as a 16:9 image asset.
- **Word document** → hand the PNG to `word-creator`. Provide the absolute
  path; it will be embedded at native resolution.
- **Re-render later** → if PNG was skipped because the draw.io desktop CLI
  was missing at build time, run:
  ```bash
  pnpm drawio:export-png --in <abs-path>/<name>.drawio --out <abs-path>/<name>.png
  ```
  This is the standalone re-render path; it does NOT re-run validate / audit.

## 8. Install helper (when draw.io desktop CLI is missing)

The build pipeline needs the [draw.io desktop
CLI](https://github.com/jgraph/drawio-desktop/releases) to produce PNG. If the
doctor reports it missing, run:

```bash
pnpm drawio:install:drawio-cli   # prints install steps for current OS
# Then either add `drawio` to PATH, or set DRAWIO_CLI=/absolute/path/to/drawio
```

Without the CLI, the build still produces a valid `.drawio` file. PNG render
is skipped with a clear warning — never silent.

## Container nesting (authoritative order)

```
AWS Cloud
└── Region
    └── VPC
        └── AZ
            └── Subnet
            │   └── Security Group
            └── Route Table
```

Managed / global services (IAM, CloudFront, Route 53, S3, DynamoDB, SQS/SNS)
sit **outside** the VPC — they are not subnet-resident.

## Self-check before delivering

- [ ] Built with the layout engine — no hand-written coordinates anywhere.
- [ ] `drawio-ai validate` exits clean (no warnings, no advice).
- [ ] Every icon came from `drawio-ai search` (category colors intact).
- [ ] `drawio-ai render` vision self-check passed.
- [ ] Output written under the user's project, not the kit, not `cwd`.
- [ ] Diagram title matches the user's ask.

## When NOT to use this skill

- User asks for a **simple flowchart / sequence diagram / class diagram** →
  use `beautiful-mermaid` (text-first, lighter).
- User asks for a non-AWS cloud (Azure / GCP / Databricks / BPMN) → out of
  pilot scope; tell the user which domain we don't support yet and offer
  Mermaid as a fallback.
- User wants to **edit** an existing `.drawio` file → this skill is for
  *generating* from spec, not for round-trip editing.
- User wants a slide deck → use `morph-ppt`; feed it the PNG output from
  step 5 as an image asset.

## Known limitations

- `drawio-ai render` requires the [draw.io desktop
  CLI](https://github.com/jgraph/drawio-desktop/releases) (set `DRAWIO_CLI`).
  Without it, the skill still produces a valid `.drawio` file; only the PNG
  vision-check step is skipped.
- Python 3.11 is only needed to *regenerate* the catalog from the upstream
  shape index. Pre-built catalogs are shipped in the npm package, so Python is
  not required for normal use.
- Graphviz is optional — only used by `vendor/autolayout.py` for >15-node
  graphs.