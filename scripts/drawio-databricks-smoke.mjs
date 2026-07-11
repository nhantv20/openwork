// Smoke Databricks build: minimal Lakehouse medallion (Sources → Ingestion
// → Bronze/Silver/Gold → Serving → Consumers). Uses the declarative layout
// engine + Databricks house style (coral + navy bands).
//
// Run via:
//   pnpm drawio:databricks:smoke

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ROOT = process.env.DRAWIO_AI_KIT_ROOT;
const OUT = process.env.DRAWIO_OUT;
const NAME = process.env.DRAWIO_NAME ?? "smoke-lakehouse";

if (!ROOT) {
  console.error("DRAWIO_AI_KIT_ROOT is not set. Use scripts/drawio-aws-build.mjs as the entry point.");
  process.exit(2);
}
if (!OUT) {
  console.error("DRAWIO_OUT is not set. Use scripts/drawio-aws-build.mjs as the entry point.");
  process.exit(2);
}

const { Diagram } = await import(`${ROOT}/src/builder.mjs`);
const { frame, icon, box, phantom, renderTree } = await import(`${ROOT}/src/layout-engine.mjs`);

const d = new Diagram("pipeline");
const CORAL = "#FF3621";
const NAVY = "#1B3139";

const band = (id, label, fill, w, h = 34, fs = 14) =>
  box(id, label, {
    w,
    h,
    style: `rounded=0;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=none;fontColor=#FFFFFF;fontSize=${fs};fontStyle=1;verticalAlign=middle;align=center;`,
  });

const stage = (id, title, kids) =>
  frame(id, title, { dir: "col", gap: 12, stroke: NAVY }, kids);

const sources = stage("src", "Sources", [
  icon("kafka", "kafka", "Kafka (events)"),
  icon("oltp", "mysql", "OLTP DB"),
]);

const ingest = stage("ing", "Ingestion — Lakeflow", [
  icon("lfc", "lakeflow_connect", "Lakeflow Connect"),
  icon("stream", "data_streaming", "Structured Streaming"),
]);

const medallion = stage("med", "Medallion — Delta Lake", [
  phantom("medrow", "", { dir: "row", gap: 22, header: 0 }, [
    icon("bronze", "medallion_bronze", "Bronze"),
    icon("silver", "medallion_silver", "Silver"),
    icon("gold", "medallion_gold", "Gold"),
  ]),
]);

const serve = stage("serve", "Serving", [
  icon("dbsql", "databricks_sql", "Databricks SQL"),
  icon("mosaic", "mosaic_ai", "Mosaic AI"),
]);

const tree = phantom("root", "", { dir: "col", gap: 16, header: 0 }, [
  band("hdr", "Databricks Lakehouse (medallion)", CORAL, 900),
  phantom("bands", "", { dir: "row", gap: 22, header: 0, align: "top" }, [sources, ingest, medallion, serve]),
  band("gov", "Governance — Unity Catalog", NAVY, 900),
]);
renderTree(d, tree, [40, 70]);
d.title("OpenWork smoke — Databricks Lakehouse");

d.link("kafka", "lfc");
d.link("oltp", "lfc");
d.link("lfc", "bronze");
d.link("stream", "bronze");
d.link("bronze", "silver");
d.link("silver", "gold");
d.link("gold", "dbsql");
d.link("gold", "mosaic");

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