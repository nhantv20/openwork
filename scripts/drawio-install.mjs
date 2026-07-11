#!/usr/bin/env node
// drawio-install.mjs — User-initiated wrapper around `npm i -g` for the kit.
//
// CRITICAL: this script must only run when the USER explicitly invokes it
// (e.g. `pnpm drawio:install`). Agents must NOT call this — they should call
// `node scripts/drawio-doctor.mjs` to detect + print the install hint.
//
// Reads the pinned commit from vendor/drawio-ai-kit.PIN.md and installs:
//     npm i -g github:sparklabx/drawio-ai-kit#<commit>
//
// Flags:
//   --dry-run    print the command without running it
//   --force      re-install even if the current install already matches the pin
//
// Exit codes:
//   0 = install succeeded (or already at pin)
//   1 = install failed
//   2 = PIN file malformed

import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIN_FILE = resolve(__dirname, "..", "vendor", "drawio-ai-kit.PIN.md");

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

if (!existsSync(PIN_FILE)) {
  console.error(`PIN file not found at ${PIN_FILE}`);
  process.exit(2);
}

const text = await readFile(PIN_FILE, "utf8");
const commit = text.match(/commit\s*\|\s*`?([0-9a-f]{40})`?/i)?.[1];
const version = text.match(/version\s*\|\s*`?([0-9.]+)`?/i)?.[1];
if (!commit) {
  console.error("PIN file is malformed (missing commit)");
  process.exit(2);
}

const spec = `github:sparklabx/drawio-ai-kit#${commit}`;
const cmd = `npm i -g ${spec}`;

console.log(`drawio-ai-kit install`);
console.log(`  pinned: v${version ?? "?"}  commit ${commit}`);
console.log(`  command: ${cmd}`);

// Collision check: if a stale directory exists at the npm global prefix with
// a wrong .git (e.g. another repo reusing the name), npm will silently merge
// and our `git rev-parse` checks will read the wrong HEAD. Detect + bail.
const npmRootOut = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const collisionDir = join(npmRootOut, "drawio-ai-kit");
if (existsSync(join(collisionDir, "package.json"))) {
  const existing = JSON.parse(execFileSync("cat", [join(collisionDir, "package.json")], { encoding: "utf8" }));
  if (existing.name !== "drawio-ai-kit" || existing.version !== "1.0.0") {
    console.error("");
    console.error(`! collision detected at ${collisionDir}`);
    console.error(`  found name="${existing.name}" version="${existing.version}"`);
    console.error(`  this directory is NOT drawio-ai-kit — npm would silently merge.`);
    console.error(`  remove it first:`);
    console.error(`    rm -rf ${collisionDir}`);
    process.exit(2);
  }
}

// Cheap pre-check: is the installed version already at the pin?
try {
  const rootOut = execFileSync("drawio-ai", ["root"], { encoding: "utf8" }).trim();
  const pkgPath = `${rootOut.replace(/\/$/, "")}/package.json`;
  const pkg = JSON.parse(execFileSync("cat", [pkgPath], { encoding: "utf8" }));
  if (pkg.name === "drawio-ai-kit" && pkg.version === version && !force) {
    console.log(`Already installed at pinned version v${version}. Use --force to re-install.`);
    process.exit(0);
  }
} catch {
  // not installed or `drawio-ai root` failed — proceed with install
}

if (dryRun) {
  console.log("(dry-run: not running install)");
  process.exit(0);
}

console.log("Running install...");
const result = spawnSync("npm", ["i", "-g", spec], { stdio: "inherit" });
process.exit(result.status ?? 1);