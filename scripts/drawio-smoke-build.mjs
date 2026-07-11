// Smoke-test AWS build: a minimal "3-tier web app on AWS" using the
// declarative layout engine. Used to validate the end-to-end pipeline:
//   build → validate → audit → render.
//
// Run via:
//   pnpm drawio:aws:build -- --build-script scripts/drawio-smoke-build.mjs \
//     --out /tmp/openwork-diagrams/aws --name smoke-3tier
//
// Or directly:
//   DRAWIO_AI_KIT_ROOT="$(drawio-ai root)" \
//   DRAWIO_OUT="/tmp/openwork-diagrams/aws/smoke-3tier.drawio" \
//   DRAWIO_NAME="smoke-3tier" \
//     node scripts/drawio-smoke-build.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ROOT = process.env.DRAWIO_AI_KIT_ROOT;
const OUT = process.env.DRAWIO_OUT;
const NAME = process.env.DRAWIO_NAME ?? "smoke-3tier";

if (!ROOT) {
  console.error("DRAWIO_AI_KIT_ROOT is not set. Use scripts/drawio-aws-build.mjs as the entry point.");
  process.exit(2);
}
if (!OUT) {
  console.error("DRAWIO_OUT is not set. Use scripts/drawio-aws-build.mjs as the entry point.");
  process.exit(2);
}

const { Diagram } = await import(`${ROOT}/src/builder.mjs`);
const { group, icon, renderTree, box } = await import(`${ROOT}/src/layout-engine.mjs`);

const d = new Diagram("network");

const vpc = group(
  "vpc",
  "group_vpc",
  "VPC 10.0.0.0/16",
  { dir: "col", gap: 22, align: "center" },
  [
    group(
      "edge",
      null,
      "Edge tier",
      { dir: "row", gap: 24, align: "center", fill: "#FFFFFF", stroke: "#999999" },
      [
        icon("cf", "cloudfront", "CloudFront"),
        icon("waf", "waf", "WAF"),
        icon("alb", "application_load_balancer", "ALB"),
      ],
    ),
    group(
      "app",
      null,
      "App tier",
      { dir: "row", gap: 24, align: "center", fill: "#FFFFFF", stroke: "#999999" },
      [icon("ecs", "ecs", "ECS"), icon("lambda", "lambda", "Lambda")],
    ),
    group(
      "data",
      null,
      "Data tier",
      { dir: "row", gap: 24, align: "center", fill: "#FFFFFF", stroke: "#999999" },
      [icon("rds", "rds", "RDS"), icon("s3", "s3", "S3")],
    ),
  ],
);

const tree = group(
  "root",
  "group_aws_cloud_alt",
  "AWS Cloud",
  { dir: "row", gap: 50, align: "center" },
  [
    box("users", "Users", { w: 110, h: 70, fill: "#DAE8FC", stroke: "#6C8EBF", bold: true }),
    vpc,
  ],
);

renderTree(d, tree, [40, 90]);
d.title("OpenWork smoke — AWS 3-tier web app");
d.link("users", "alb");
d.link("alb", "ecs");
d.link("ecs", "rds");
d.link("ecs", "s3");

const xml = d.mxfile(NAME);
const validateResult = d.validate();
console.log("VALIDATE:", JSON.stringify(validateResult.ok ? { ok: true, errors: [], warnings: [] } : validateResult));
if (!validateResult.ok) {
  console.error("Validation failed; refusing to write .drawio");
  console.error(JSON.stringify(validateResult, null, 2));
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, xml);
console.log(`wrote ${OUT}`);