// Smoke Azure build: minimal hub-spoke landing zone (subscription → RG →
// VNet). Uses the declarative layout engine — no hand-written coordinates.
//
// Run via:
//   pnpm drawio:azure:smoke
//   (or directly: DRAWIO_AI_KIT_ROOT="$(drawio-ai root)" \
//                 DRAWIO_OUT="/abs/path/azure-hub-spoke.drawio" \
//                 node scripts/drawio-azure-smoke.mjs)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ROOT = process.env.DRAWIO_AI_KIT_ROOT;
const OUT = process.env.DRAWIO_OUT;
const NAME = process.env.DRAWIO_NAME ?? "smoke-hub-spoke";

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

const d = new Diagram("hubspoke");
const BLUE = "#0078D4";

const spoke = (id, label, vmName) =>
  frame(id, label, { dir: "row", gap: 24, stroke: "#8AB4D8", cornerIcon: "azure_virtual_networks" }, [
    icon(`${id}_vm`, "azure_virtual_machine", vmName),
  ]);

const hub = frame(
  "hub",
  "HUB VNet (shared services)",
  { dir: "col", gap: 18, stroke: BLUE, cornerIcon: "azure_virtual_networks" },
  [
    icon("fw", "azure_firewalls", "Azure Firewall"),
    icon("dns", "azure_dns_zones", "Azure DNS (Private Resolver)"),
    icon("kv", "azure_key_vaults", "Key Vault"),
  ],
);

const rg = frame(
  "rg",
  "Resource Group: rg-hub-spoke",
  { dir: "row", gap: 30, align: "top", cornerIcon: "azure_resource_groups" },
  [
    hub,
    spoke("spoke_a", "SPOKE A VNet (prod)", "App VM"),
    spoke("spoke_b", "SPOKE B VNet (dev)", "App VM"),
  ],
);

const tree = frame(
  "root",
  "Azure Hub-Spoke Landing Zone (Subscription → RG → VNet)",
  { dir: "col", gap: 28 },
  [
    frame("sub", "Subscription: Production", {
      dir: "col",
      gap: 20,
      stroke: "#555555",
      cornerIcon: "azure_subscriptions",
    }, [rg]),
    frame("globals", "Global (Tenant)", { dir: "row", gap: 24, stroke: "#B0B0B0" }, [
      icon("aad", "azure_entra_connect", "Entra ID"),
    ]),
  ],
);

renderTree(d, tree, [40, 80]);
d.title("OpenWork smoke — Azure Hub-Spoke Landing Zone");

// Peering: spoke → hub, both spokes fan in to hub firewall
d.link("spoke_a_vm", "fw");
d.link("spoke_b_vm", "fw");

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