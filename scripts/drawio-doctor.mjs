#!/usr/bin/env node
// drawio-doctor.mjs — Diagnose the drawio-ai-kit install state.
//
// Prints a short report:
//   - is the `drawio-ai` CLI on PATH?
//   - is the installed commit the one pinned in vendor/drawio-ai-kit.PIN.md?
//   - is the draw.io desktop CLI available (for PNG render)?
//   - exact install command the user should run to fix any drift.
//
// Usage:
//   node scripts/drawio-doctor.mjs
//   node scripts/drawio-doctor.mjs --json
//   pnpm drawio:doctor
//
// Exit codes:
//   0 = healthy (CLI installed, commit matches, optional deps surfaced)
//   1 = CLI missing (user needs to install)
//   2 = CLI installed but commit drifted from PIN
//
// This script NEVER runs npm install. It only reports.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIN_FILE = resolve(__dirname, "..", "vendor", "drawio-ai-kit.PIN.md");

const json = process.argv.includes("--json");
const log = json ? () => {} : (...args) => console.log(...args);
const warn = json ? () => {} : (...args) => console.warn(...args);

async function readPin() {
  if (!existsSync(PIN_FILE)) {
    return { ok: false, reason: `PIN file not found at ${PIN_FILE}` };
  }
  const text = await readFile(PIN_FILE, "utf8");
  const commit = text.match(/commit\s*\|\s*`?([0-9a-f]{40})`?/i)?.[1];
  const version = text.match(/version\s*\|\s*`?([0-9.]+)`?/i)?.[1];
  if (!commit || !version) {
    return { ok: false, reason: "PIN file is malformed (missing commit/version)" };
  }
  return { ok: true, commit, version };
}

function which(bin) {
  try {
    const out = execFileSync("which", [bin], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function runDrawioAi(args) {
  try {
    return { ok: true, stdout: execFileSync("drawio-ai", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (error) {
    return { ok: false, code: error.status ?? -1, stderr: String(error.stderr ?? error.message) };
  }
}

function installedKitMetadata(kitRoot) {
  if (!kitRoot) return null;
  // Read package.json from the install root — most reliable way to identify
  // the kit without depending on the directory's git ancestry (which can
  // belong to a parent repo like Homebrew).
  try {
    const pkgPath = `${kitRoot.replace(/\/$/, "")}/package.json`;
    const text = execFileSync("cat", [pkgPath], { encoding: "utf8" });
    const pkg = JSON.parse(text);
    return { name: pkg.name, version: pkg.version };
  } catch {
    return null;
  }
}

const pin = await readPin();
const cliPath = which("drawio-ai");
const drawioCliPath = which("drawio") ?? process.env.DRAWIO_CLI ?? null;
const pythonPath = which("python3.11") ?? which("python3") ?? null;

const report = {
  pin: pin.ok ? { version: pin.version, commit: pin.commit } : { error: pin.reason },
  cli: { installed: Boolean(cliPath), path: cliPath },
  drawio_cli: { installed: Boolean(drawioCliPath), path: drawioCliPath },
  python: { installed: Boolean(pythonPath), path: pythonPath },
  commit_drift: null,
  install_command: pin.ok
    ? `npm i -g github:sparklabx/drawio-ai-kit#${pin.commit}`
    : null,
};

let exitCode = 0;

if (!cliPath) {
  report.cli.error = "drawio-ai not found on PATH";
  exitCode = 1;
} else {
  // Probe the kit root + installed metadata
  const rootProbe = runDrawioAi(["root"]);
  if (rootProbe.ok) {
    const kitRoot = rootProbe.stdout.trim();
    const installed = installedKitMetadata(kitRoot);
    report.cli.kit_root = kitRoot;
    report.cli.installed = installed ?? null;
    if (!installed || installed.name !== "drawio-ai-kit") {
      report.cli.error = `installed kit at ${kitRoot} is not drawio-ai-kit (got ${installed?.name ?? "nothing"})`;
      exitCode = 1;
    } else if (pin.ok && installed.version !== pin.version) {
      report.commit_drift = {
        expected_version: pin.version,
        expected_commit: pin.commit,
        actual_version: installed.version,
        fix: `npm i -g github:sparklabx/drawio-ai-kit#${pin.commit}`,
      };
      exitCode = 2;
    }
  } else {
    report.cli.error = `drawio-ai root failed (exit ${rootProbe.code})`;
    exitCode = 1;
  }
}

if (json) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(exitCode);
}

// Human-readable
log("\n=== drawio-ai-kit doctor ===\n");
if (pin.ok) {
  log(`Pinned upstream: v${pin.version}  commit ${pin.commit}`);
} else {
  warn(`PIN file issue: ${pin.reason}`);
}

log("");
log(`  drawio-ai CLI:   ${report.cli.installed ? "OK  " + (report.cli.path ?? "") : "MISSING"}`);
if (report.cli.kit_root) log(`  kit root:        ${report.cli.kit_root}`);
if (report.cli.installed) log(`  installed:       ${report.cli.installed.name}@${report.cli.installed.version}`);
if (report.commit_drift) {
  warn(`  VERSION DRIFT:   expected v${report.commit_drift.expected_version} (commit ${report.commit_drift.expected_commit.slice(0, 8)})`);
  warn(`                  actual   v${report.commit_drift.actual_version}`);
}

log("");
log(`  drawio CLI:      ${report.drawio_cli.installed ? "OK  " + (report.drawio_cli.path ?? "") : "not found (PNG render disabled, .drawio still works)"}`);
log(`  python3.11:      ${report.python.installed ? "OK  " + (report.python.path ?? "") : "not found (only needed to regenerate the icon catalog)"}`);

log("");
if (exitCode === 0) {
  log("All checks passed. The drawio-ai pilot is ready.");
} else if (exitCode === 1) {
  if (report.cli.error) {
    warn(`drawio-ai: ${report.cli.error}`);
  } else {
    warn("drawio-ai CLI is missing. To install:");
    warn(`  ${report.install_command}`);
    warn("Or, after the user confirms:");
    warn("  pnpm drawio:install");
  }
} else if (exitCode === 2) {
  warn("drawio-ai is installed but the version drifted from the PIN. To re-pin:");
  warn(`  ${report.commit_drift.fix}`);
}

log("");
process.exit(exitCode);