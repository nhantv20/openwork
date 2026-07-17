import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const KIT = "file:///C:/Users/NhanTV20/AppData/Roaming/npm/node_modules/drawio-ai-kit";
import { Diagram } from "file:///C:/Users/NhanTV20/AppData/Roaming/npm/node_modules/drawio-ai-kit/src/builder.mjs";
import { group, frame, icon, box, phantom, renderTree } from "file:///C:/Users/NhanTV20/AppData/Roaming/npm/node_modules/drawio-ai-kit/src/layout-engine.mjs";

const d = new Diagram("network");

const az = (s, ec2id, ec2Label) =>
  group(`az_${s}`, "group_availability_zone", `Availability Zone ${s.toUpperCase()}`, { dir: "col", gap: 16, align: "center" }, [
    group(`subnet_${s}`, "group_subnet", "Public Subnet", { dir: "col", gap: 10, align: "center" }, [
      icon(ec2id, "ec2", ec2Label),
    ]),
  ]);

const region = group("region", "group_region", "ap-southeast-1", { dir: "row", gap: 50, align: "top" }, [
  group("vpc", "group_vpc", "VPC  10.0.0.0/16", { dir: "col", gap: 22, align: "center" }, [
    icon("alb", "application_load_balancer", "ALB (Multi-AZ)"),
    phantom("azs", "", { dir: "row", gap: 40, align: "top", header: 0 }, [
      az("a", "ec2_1", "EC2 Web Server"),
      az("b", "ec2_2", "EC2 App Server"),
    ]),
  ]),
  group("reg_svc", null, "Regional Services", { dir: "col", gap: 22, fill: "#FFFFFF", stroke: "#999999" }, [
    icon("s3", "s3", "S3"),
    icon("cw", "cloudwatch_2", "CloudWatch"),
  ]),
]);

const tree = phantom("root", "", { dir: "row", gap: 70, align: "center", header: 0, pad: 10 }, [
  box("users", "Users", { w: 120, h: 70, fill: "#DAE8FC", stroke: "#6C8EBF", bold: true }),
  region,
]);

renderTree(d, tree, [40, 90]);
d.title("2 EC2 instances across 2 AZs — Multi-AZ");

d.link("users", "alb", "HTTPS");
d.link("alb", "ec2_1", "", { role: "fanout" });
d.link("alb", "ec2_2", "", { role: "fanout" });
d.link("ec2_1", "s3", "read/write", { dash: true });

const out = process.env.DRAWIO_OUT || "C:/Users/NhanTV20/Project/openwork/diagrams/aws/basic_2ec2_az.drawio";
const name = process.env.DRAWIO_NAME || "Basic AWS — 2 EC2 in AZ";

const res = d.validate();
console.log("VALIDATE:", JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, advice: res.audit.advice }));
writeFileSync(out, d.mxfile(name));
console.log(`wrote ${out}`);
