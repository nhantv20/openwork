// Smoke BPMN build: minimal pool + lanes + phases (Customer / Sales /
// Warehouse × Intake / Review / Fulfill). Uses the BPMN shape primitives
// from `drawio-ai-kit/src/bpmn.mjs`.
//
// Run via:
//   pnpm drawio:bpmn:smoke

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ROOT = process.env.DRAWIO_AI_KIT_ROOT;
const OUT = process.env.DRAWIO_OUT;
const NAME = process.env.DRAWIO_NAME ?? "smoke-process";

if (!ROOT) {
  console.error("DRAWIO_AI_KIT_ROOT is not set. Use scripts/drawio-aws-build.mjs as the entry point.");
  process.exit(2);
}
if (!OUT) {
  console.error("DRAWIO_OUT is not set. Use scripts/drawio-aws-build.mjs as the entry point.");
  process.exit(2);
}

const { Diagram } = await import(`${ROOT}/src/builder.mjs`);
const { renderTree } = await import(`${ROOT}/src/layout-engine.mjs`);
const { pool, start, end, gateway, userTask, serviceTask } = await import(`${ROOT}/src/bpmn.mjs`);

const d = new Diagram("bpmn");

const proc = pool(
  "order",
  "Order Management",
  {
    lanes: ["Customer", "Sales", "Warehouse"],
    phases: ["Intake", "Review", "Fulfill"],
  },
  [
    start("s1", { lane: 0, col: 0, label: "Order received" }),
    userTask("t1", { lane: 0, col: 1, label: "Place order" }),
    userTask("t2", { lane: 1, col: 2, label: "Review order" }),
    gateway("g1", { lane: 1, col: 3, label: "Approved?" }),
    serviceTask("t3", { lane: 1, col: 4, label: "Charge card" }),
    end("e2", { lane: 1, col: 5, label: "Rejected", type: "error" }),
    serviceTask("t4", { lane: 2, col: 5, label: "Ship order" }),
    end("e1", { lane: 2, col: 6, label: "Delivered" }),
  ],
);

renderTree(d, proc, [40, 80]);
d.title("OpenWork smoke — Order Management BPMN swimlane");

d.link("s1", "t1", "submit", { flow: true, rounded: true });
d.link("t1", "t2", "placed", { flow: true, rounded: true });
d.link("t2", "g1", "", { flow: true, rounded: true });
d.link("g1", "t3", "yes", { flow: true, rounded: true });
d.link("g1", "e2", "no", { rounded: true });
d.link("t3", "t4", "fulfill", { flow: true, rounded: true });
d.link("t4", "e1", "", { flow: true, rounded: true });

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