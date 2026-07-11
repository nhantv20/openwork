#!/usr/bin/env node
// drawio-aws-build.mjs — Build → validate → render pipeline for AWS diagrams.
//
// Wraps the upstream `drawio-ai` CLI with sensible defaults for OpenWork:
//   - Runs `validate` after build, hard-fails on errors.
//   - Runs `audit` and surfaces warnings.
//   - Runs `render` to PNG if the draw.io CLI is on PATH or DRAWIO_CLI is set.
//   - Writes outputs to the user's project (caller passes `--out <dir>`).
//   - Verifies the installed commit matches vendor/drawio-ai-kit.PIN.md.
//
// Usage:
//   node scripts/drawio-aws-build.mjs --build-script path/to/build.mjs \
//     --out /abs/path/to/user-project/diagrams/aws \
//     --name my-vpc
//
//   pnpm drawio:aws:build -- --build-script ./build_my_vpc.mjs \
//     --out ./diagrams/aws --name my-vpc
//
// The `--build-script` must be a Node ESM file that:
//   1. imports `Diagram` from `${drawioAiRoot}/src/builder.mjs`
//   2. constructs the diagram, calls `d.validate()`, calls `d.mxfile(path)`
// It writes the .drawio to <out>/<name>.drawio before this wrapper runs the
// post-build steps.
//
// Exit codes:
//   0 = build clean (validate ok, audit clean or warn-only, render ok or
//       skipped because drawio CLI missing)
//   1 = build script failed / file not produced
//   2 = validate failed
//   3 = commit drift (refusing to proceed)
//   4 = render failed (validate+audit already passed)

import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIN_FILE = resolve(__dirname, "..", "vendor", "drawio-ai-kit.PIN.md");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const buildScript = args["build-script"];
const outDirRaw = args.out;
const name = args.name;
const skipRender = args["skip-render"] === true;

function die(code, msg) {
  console.error(`drawio-aws-build: ${msg}`);
  process.exit(code);
}

if (!buildScript) die(1, "--build-script <path-to.mjs> is required");
if (!outDirRaw) die(1, "--out <absolute-or-relative-dir> is required");
if (!name) die(1, "--name <diagram-name> is required");

// Resolve paths
const buildScriptPath = isAbsolute(buildScript) ? buildScript : resolve(process.cwd(), buildScript);
const outDir = isAbsolute(outDirRaw) ? outDirRaw : resolve(process.cwd(), outDirRaw);
const drawioPath = join(outDir, `${name}.drawio`);
const pngPath = join(outDir, `${name}.png`);

if (!existsSync(buildScriptPath)) die(1, `build script not found: ${buildScriptPath}`);
await mkdir(outDir, { recursive: true });

// 1. PIN check
if (!existsSync(PIN_FILE)) die(1, `PIN file not found: ${PIN_FILE}`);
const pinText = await readFile(PIN_FILE, "utf8");
const pinnedCommit = pinText.match(/commit\s*\|\s*`?([0-9a-f]{40})`?/i)?.[1];
if (!pinnedCommit) die(1, "PIN file malformed (no commit)");

// 2. CLI presence
function which(bin) {
  try { return execFileSync("which", [bin], { encoding: "utf8" }).trim() || null; }
  catch { return null; }
}
const cli = which("drawio-ai");
if (!cli) die(1, `drawio-ai CLI not found on PATH. Run: pnpm drawio:install`);

// 3. Version drift check (read package.json — git ancestry is unreliable
//    because the install root may live under a parent repo like /opt/homebrew)
const kitRoot = execFileSync("drawio-ai", ["root"], { encoding: "utf8" }).trim();
const installedPkg = JSON.parse(
  execFileSync("cat", [`${kitRoot.replace(/\/$/, "")}/package.json`], { encoding: "utf8" })
);
const pinnedVersion = pinText.match(/version\s*\|\s*`?([0-9.]+)`?/i)?.[1];
if (installedPkg.name !== "drawio-ai-kit" || installedPkg.version !== pinnedVersion) {
  die(
    3,
    `version drift: installed=${installedPkg.name}@${installedPkg.version} ` +
      `pinned=drawio-ai-kit@${pinnedVersion} (commit ${pinnedCommit.slice(0, 8)}). ` +
      `Run: pnpm drawio:install`,
  );
}

// 4. Run the build script. We expose the kit root + output path via env so
//    the build script can import the engine by absolute path (matches the
//    upstream convention shown by `drawio-ai workflow`).
console.log(`[1/4] running build script: ${buildScriptPath}`);
const buildResult = spawnSync(process.execPath, [buildScriptPath, `--out`, drawioPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    DRAWIO_AI_KIT_ROOT: kitRoot,
    DRAWIO_OUT: drawioPath,
    DRAWIO_NAME: name,
  },
});
if (buildResult.status !== 0) die(1, `build script exited ${buildResult.status}`);

if (!existsSync(drawioPath)) die(1, `build script did not produce ${drawioPath}`);
const stat = statSync(drawioPath);
if (stat.size === 0) die(1, `build script produced an empty file at ${drawioPath}`);
console.log(`       wrote ${drawioPath} (${stat.size} bytes)`);

// 5. Validate
console.log(`[2/4] validate: drawio-ai validate ${drawioPath}`);
const validateResult = spawnSync("drawio-ai", ["validate", drawioPath], { stdio: "inherit" });
if (validateResult.status !== 0) die(2, `validate exited ${validateResult.status}`);

// 6. Audit (aesthetic, non-fatal)
console.log(`[3/4] audit: drawio-ai audit ${drawioPath}`);
const auditResult = spawnSync("drawio-ai", ["audit", drawioPath], { stdio: "inherit" });
// audit is soft — only hard-fail if exit code is non-zero AND we passed --strict
if (args.strict && auditResult.status !== 0) {
  die(4, `audit (strict) exited ${auditResult.status}`);
}

// 7. Render (PNG) — Phase 1: always try when draw.io CLI is available, fail
//    loud when --strict and CLI missing. Without --strict, surface a clear
//    warning + the install hint, then continue (the .drawio file is still
//    valid and the user can render later via `pnpm drawio:export-png`).
const drawioCli = process.env.DRAWIO_CLI ?? which("drawio");
if (skipRender) {
  console.log(`[4/4] render: skipped (--skip-render)`);
  console.log(`       .drawio file is at ${drawioPath}`);
  console.log(`       re-run without --skip-render (and with DRAWIO_CLI) to produce PNG`);
} else if (!drawioCli) {
  const hint =
    "draw.io desktop CLI not found. Install from:\n" +
    "       https://github.com/jgraph/drawio-desktop/releases\n" +
    "       macOS:  /Applications/draw.io.app/Contents/MacOS/drawio\n" +
    "       Or set DRAWIO_CLI=/absolute/path/to/drawio";
  if (args.strict) die(4, `render: cannot produce PNG.\n${hint}`);
  console.log(`[4/4] render: skipped (draw.io CLI not found)`);
  console.log(hint.split("\n").map((l) => `       ${l}`).join("\n"));
  console.log(`       .drawio file is at ${drawioPath}`);
  console.log(`       rerun with DRAWIO_CLI=/path/to/drawio OR pnpm drawio:export-png --in ${drawioPath} --out ${pngPath}`);
} else {
  console.log(`[4/4] render: drawio-ai render ${drawioPath} -o ${pngPath}`);
  const renderResult = spawnSync("drawio-ai", ["render", drawioPath, "-o", pngPath], {
    stdio: "inherit",
    env: { ...process.env, DRAWIO_CLI: drawioCli },
  });
  if (renderResult.status !== 0) die(4, `render exited ${renderResult.status}`);
  if (!existsSync(pngPath)) die(4, `render reported success but ${pngPath} was not created`);
  const pngStat = statSync(pngPath);
  if (pngStat.size === 0) die(4, `render produced an empty file at ${pngPath}`);
  console.log(`       wrote ${pngPath} (${pngStat.size} bytes)`);
}

console.log("");
console.log("DONE. Open the .drawio file in draw.io or app.diagrams.net to inspect.");