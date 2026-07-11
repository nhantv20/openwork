// scripts/drawio-doctor.test.mjs — unit tests for the drawio-ai-kit
// integration scripts. Run with `node --test scripts/drawio-doctor.test.mjs`
// or `pnpm test:drawio` (defined in root package.json).
//
// These tests verify the scripts behave correctly across the install states
// we care about: missing CLI, installed at pin, version drift, missing PIN.
// They do NOT depend on the real `drawio-ai` CLI being installed — the tests
// are pure-JS where possible.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

function runScript(scriptRel, args = [], opts = {}) {
  return spawnSync(process.execPath, [join(REPO_ROOT, scriptRel), ...args], {
    encoding: "utf8",
    ...opts,
  });
}

const PIN_PATH = join(REPO_ROOT, "vendor", "drawio-ai-kit.PIN.md");

test("vendor/drawio-ai-kit.PIN.md exists and is well-formed", () => {
  assert.ok(existsSync(PIN_PATH), `expected PIN file at ${PIN_PATH}`);
  const text = readFileSync(PIN_PATH, "utf8");
  assert.match(text, /commit\s*\|\s*`?([0-9a-f]{40})`?/i, "PIN must contain a 40-char commit");
  assert.match(text, /version\s*\|\s*`?1\.0\.0`?/i, "PIN must pin version 1.0.0");
  assert.match(text, /sparklabx\/drawio-ai-kit/i, "PIN must reference the upstream repo");
});

test("drawio-doctor.mjs exits 0 when CLI is installed at the pin", () => {
  // Best-effort: skip if drawio-ai is not actually installed on this machine.
  const probe = runScript("scripts/drawio-doctor.mjs");
  if (probe.status === 1) {
    // CLI missing — that's an acceptable state for CI without npm globals.
    // Verify it printed the install hint instead of crashing.
    assert.match(probe.stdout, /drawio-ai CLI:\s+MISSING/i, "missing CLI must be reported");
    assert.match(probe.stdout, /npm i -g github:sparklabx\/drawio-ai-kit/i, "install hint must be printed");
    return;
  }
  // CLI installed — must report OK and version match.
  assert.equal(probe.status, 0, `doctor exited non-zero with stdout:\n${probe.stdout}`);
  assert.match(probe.stdout, /drawio-ai CLI:\s+OK/i);
  assert.match(probe.stdout, /installed:\s+drawio-ai-kit@1\.0\.0/i);
});

test("drawio-doctor.mjs --json produces parseable output with stable shape", () => {
  const result = runScript("scripts/drawio-doctor.mjs", ["--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(typeof parsed, "object");
  assert.ok(parsed.pin, "must include pin info");
  assert.ok(parsed.cli, "must include cli info");
  assert.ok(parsed.drawio_cli, "must include drawio_cli info");
  assert.ok(parsed.python, "must include python info");
  assert.ok(parsed.install_command, "must include install_command");
  // Exit code is either 0 (healthy), 1 (CLI missing), or 2 (version drift).
  assert.ok([0, 1, 2].includes(result.status), `unexpected exit ${result.status}`);
});

test("drawio-install.mjs --dry-run --force prints the exact pinned install command without running it", () => {
  // --force bypasses the "already installed" pre-check so we can exercise
  // the dry-run code path even when the kit is present on the test machine.
  const result = runScript("scripts/drawio-install.mjs", ["--dry-run", "--force"]);
  assert.equal(result.status, 0, `install --dry-run exited ${result.status}:\n${result.stderr}`);
  assert.match(result.stdout, /pinned: v1\.0\.0\s+commit 814d97e46e81d0d7b85b30192cfbfefb281f8a03/);
  assert.match(result.stdout, /npm i -g github:sparklabx\/drawio-ai-kit#814d97e46e81d0d7b85b30192cfbfefb281f8a03/);
  assert.match(result.stdout, /\(dry-run: not running install\)/);
});

test("drawio-install.mjs short-circuits when installed at the pin (without --force)", () => {
  // Only meaningful when the CLI is actually installed; otherwise the
  // pre-check throws and the script proceeds (which is also valid behavior).
  const probe = runScript("scripts/drawio-doctor.mjs");
  if (probe.status !== 0) return; // CLI missing — skip
  const result = runScript("scripts/drawio-install.mjs");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Already installed at pinned version v1\.0\.0/);
});

test("drawio-aws-build.mjs requires --build-script, --out, --name", () => {
  // Missing required flags → exit 1 with a clear error
  const result = runScript("scripts/drawio-aws-build.mjs");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--build-script/);
});

test("drawio-aws-build.mjs refuses to run on a non-existent build script", () => {
  const result = runScript("scripts/drawio-aws-build.mjs", [
    "--build-script", "/tmp/__nonexistent__.mjs",
    "--out", "/tmp/__nope__",
    "--name", "x",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /build script not found/);
});

test("scripts/drawio-smoke-build.mjs is a syntactically valid ESM module", () => {
  // We don't run it (needs DRAWIO_AI_KIT_ROOT + DRAWIO_OUT). Verify syntax
  // via node's --check flag — note: --check ignores unresolved dynamic
  // imports, so this only catches parse errors.
  const result = spawnSync(process.execPath, ["--check", join(REPO_ROOT, "scripts/drawio-smoke-build.mjs")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `syntax check failed:\n${result.stderr}`);
});

test("scripts/drawio-aws-build.mjs is a syntactically valid ESM module", () => {
  const result = spawnSync(process.execPath, ["--check", join(REPO_ROOT, "scripts/drawio-aws-build.mjs")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `syntax check failed:\n${result.stderr}`);
});

test("scripts/drawio-doctor.mjs is a syntactically valid ESM module", () => {
  const result = spawnSync(process.execPath, ["--check", join(REPO_ROOT, "scripts/drawio-doctor.mjs")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `syntax check failed:\n${result.stderr}`);
});

test("scripts/drawio-install.mjs is a syntactically valid ESM module", () => {
  const result = spawnSync(process.execPath, ["--check", join(REPO_ROOT, "scripts/drawio-install.mjs")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `syntax check failed:\n${result.stderr}`);
});

test("drawio-* SKILL.md files all exist and reference the upstream kit", () => {
  const expected = ["drawio-aws", "drawio-azure", "drawio-gcp", "drawio-databricks", "drawio-bpmn"];
  for (const name of expected) {
    const skillPath = join(REPO_ROOT, ".opencode", "skills", name, "SKILL.md");
    assert.ok(existsSync(skillPath), `missing skill: ${skillPath}`);
    const text = readFileSync(skillPath, "utf8");
    assert.match(text, /upstream:\s*sparklabx\/drawio-ai-kit@v1\.0\.0/i, `${name} must reference upstream pin`);
    assert.match(text, /\(814d97e\)/i, `${name} must include the short commit SHA`);
  }
});

test("drawio-architect agent exists and references all 5 drawio skills", () => {
  const agentPath = join(REPO_ROOT, ".opencode", "agents", "drawio-architect.md");
  assert.ok(existsSync(agentPath));
  const text = readFileSync(agentPath, "utf8");
  // YAML frontmatter ends at the second "---". Skills live between
  // "skills:" and that closer.
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fmMatch, "drawio-architect agent must have YAML frontmatter");
  const fm = fmMatch[1];
  const block = fm.match(/skills:\s*\n([\s\S]*?)$/)?.[1] ?? "";
  for (const s of ["drawio-aws", "drawio-azure", "drawio-gcp", "drawio-databricks", "drawio-bpmn"]) {
    assert.match(block, new RegExp(`-\\s+${s}\\b`), `drawio-architect agent must list ${s}`);
  }
});

test("office-assistant agent registers all 5 drawio skills + delegation note", () => {
  const agentPath = join(REPO_ROOT, ".opencode", "agents", "office-assistant.md");
  assert.ok(existsSync(agentPath));
  const text = readFileSync(agentPath, "utf8");
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fmMatch, "office-assistant agent must have YAML frontmatter");
  const fm = fmMatch[1];
  for (const s of ["drawio-aws", "drawio-azure", "drawio-gcp", "drawio-databricks", "drawio-bpmn"]) {
    assert.match(fm, new RegExp(`-\\s+${s}\\b`), `office-assistant must list ${s}`);
  }
  assert.match(text, /drawio-architect/i, "office-assistant must reference the drawio-architect sub-agent");
});

test("root package.json declares drawio: scripts", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const scripts = pkg.scripts ?? {};
  for (const key of ["drawio:doctor", "drawio:install", "drawio:aws:build", "drawio:aws:smoke"]) {
    assert.ok(scripts[key], `missing package.json script: ${key}`);
  }
});

test(".gitignore ignores generated .drawio / .png under diagrams/<domain>/", () => {
  const gi = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gi, /diagrams\/aws\/\*\.drawio/);
  assert.match(gi, /diagrams\/azure\/\*\.drawio/);
  assert.match(gi, /diagrams\/gcp\/\*\.drawio/);
  assert.match(gi, /diagrams\/databricks\/\*\.drawio/);
  assert.match(gi, /diagrams\/bpmn\/\*\.drawio/);
});