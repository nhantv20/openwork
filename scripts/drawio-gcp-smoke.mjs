// Smoke GCP build: minimal global VPC across two regions (Project → global
// VPC → regional Subnets). Uses the declarative layout engine.
//
// Run via:
//   pnpm drawio:gcp:smoke

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ROOT = process.env.DRAWIO_AI_KIT_ROOT;
const OUT = process.env.DRAWIO_OUT;
const NAME = process.env.DRAWIO_NAME ?? "smoke-vpc";

if (!ROOT) {
  console.error("DRAWIO_AI_KIT_ROOT is not set. Use scripts/drawio-aws-build.mjs as the entry point.");
  process.exit(2);
}
if (!OUT) {
  console.error("DRAWIO_OUT is not set. Use scripts/drawio-aws-build.mjs as the entry point.");
  process.exit(2);
}

const { Diagram } = await import(`${ROOT}/src/builder.mjs`);
const { frame, icon, renderTree } = await import(`${ROOT}/src/layout-engine.mjs`);

const d = new Diagram("network");
const GBLUE = "#4285F4";

const region = (id, label, kids) =>
  frame(id, label, { dir: "col", gap: 12, stroke: "#8AB4F8" }, [
    frame(`${id}_sn`, "Subnet (regional)", { dir: "col", gap: 10, stroke: "#B0C7EE" }, kids),
  ]);

const vpc = frame(
  "vpc",
  "VPC (global)  default",
  { dir: "row", gap: 40, align: "top", stroke: GBLUE, cornerIcon: "gcp_virtual_private_cloud" },
  [
    region("us", "Region: us-central1", [
      icon("gke", "gcp_google_kubernetes_engine", "GKE"),
      icon("gce_us", "gcp_compute_engine", "Compute Engine"),
    ]),
    region("eu", "Region: europe-west1", [
      icon("run", "gcp_cloud_run", "Cloud Run"),
    ]),
  ],
);

const project = frame(
  "proj",
  "Project: prod-proj",
  { dir: "col", gap: 20, stroke: "#555555", cornerIcon: "gcp_project" },
  [
    vpc,
    frame("managed", "Managed data services (not in VPC)", { dir: "row", gap: 20, stroke: "#999999" }, [
      icon("sql", "gcp_cloud_sql", "Cloud SQL"),
      icon("bq", "gcp_bigquery", "BigQuery"),
    ]),
  ],
);

const globals = frame("globals", "Global (spans all regions)", { dir: "row", gap: 24, stroke: "#B0B0B0" }, [
  icon("glb", "gcp_cloud_load_balancing", "Global HTTP(S) LB"),
  icon("dns", "gcp_cloud_dns", "Cloud DNS"),
]);

const tree = frame("root", "GCP global VPC multi-region", { dir: "col", gap: 30 }, [globals, project]);
renderTree(d, tree, [40, 70]);
d.title("OpenWork smoke — GCP global VPC multi-region");

d.link("glb", "gke", "", { role: "fanout" });
d.link("glb", "run", "", { role: "fanout" });
d.link("gce_us", "sql");

const validate = d.validate();
console.log("VALIDATE:", JSON.stringify({
  ok: validate.ok,
  errors: validate.errors,
  warnings: validate.warnings,
  advice: validate.audit?.advice ?? [],
}));
if (!validate.ok) {
  console.error("Validation failed; refusing to write .drawio");
  console.error(JSON.stringify(validate, null, 2));
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, d.mxfile(NAME));
console.log(`wrote ${OUT}`);