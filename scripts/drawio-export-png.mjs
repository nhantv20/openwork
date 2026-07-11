#!/usr/bin/env node
// drawio-export-png.mjs — Standalone .drawio → .png converter.
//
// Wraps `drawio-ai render` so users can convert a previously-built .drawio
// file to PNG without re-running the whole build pipeline. Used by:
//   - morph-ppt to inline architecture diagrams into slides
//   - word-creator to embed diagrams into documents
//   - docs/ to show examples in markdown
//
// Requires the draw.io desktop CLI on PATH (or DRAWIO_CLI env var).
// Without it, exits 2 with a clear install hint (the file is not silently
// skipped — the caller may want to fail loud).
//
// Usage:
//   node scripts/drawio-export-png.mjs --in foo.drawio --out foo.png
//   pnpm drawio:export-png -- --in foo.drawio --out foo.png
//   node scripts/drawio-export-png.mjs --in foo.drawio --out foo.png --scale 2
//
// Flags:
//   --in <path>      source .drawio file (required)
//   --out <path>     destination .png file (required)
//   --scale <N>      render scale 1-4 (default 1; passed through to drawio-ai)
//   --page <N>       page number for multi-page files (default 1)
//   --strict         fail if draw.io CLI is missing (default: skip with warning)
//
// Exit codes:
//   0 = success
//   1 = invalid args / missing input
//   2 = draw.io CLI missing (only when --strict; otherwise warning + exit 0)
//   3 = render failed

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, isAbsolute, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import process from "node:process";

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

function die(code, msg) {
  console.error(`drawio-export-png: ${msg}`);
  process.exit(code);
}

const args = parseArgs(process.argv);
const inputRaw = args.in;
const outputRaw = args.out;
const scale = args.scale ?? "1";
const page = args.page ?? "1";
const strict = args.strict === true;

if (!inputRaw) die(1, "--in <path-to.drawio> is required");
if (!outputRaw) die(1, "--out <path-to.png> is required");

const inputPath = isAbsolute(inputRaw) ? inputRaw : resolve(process.cwd(), inputRaw);
const outputPath = isAbsolute(outputRaw) ? outputRaw : resolve(process.cwd(), outputRaw);

if (!existsSync(inputPath)) die(1, `input not found: ${inputPath}`);
const inStat = statSync(inputPath);
if (inStat.size === 0) die(1, `input is empty: ${inputPath}`);

await mkdir(dirname(outputPath), { recursive: true });

function which(bin) {
  try { return execFileSync("which", [bin], { encoding: "utf8" }).trim() || null; }
  catch { return null; }
}

// Prereq: drawio-ai CLI
const cli = which("drawio-ai");
if (!cli) {
  die(1, `drawio-ai CLI not found on PATH. Run: pnpm drawio:install`);
}

// Prereq: draw.io desktop CLI (for render)
const drawioCli = process.env.DRAWIO_CLI ?? which("drawio");
if (!drawioCli) {
  const hint =
    "draw.io desktop CLI not found. Install from:\n" +
    "  https://github.com/jgraph/drawio-desktop/releases\n" +
    "Then either add `drawio` to PATH or set DRAWIO_CLI=/absolute/path/to/drawio.\n" +
    "  macOS app bundle:  /Applications/draw.io.app/Contents/MacOS/drawio\n" +
    "  Linux binary:      https://github.com/jgraph/drawio-desktop/releases/latest";
  if (strict) die(2, hint);
  console.warn(`drawio-export-png: ${hint}`);
  console.warn(`drawio-export-png: --strict not set; skipping render. Pass --strict to fail loud.`);
  process.exit(0);
}

// Render
console.log(`drawio-export-png: rendering ${inputPath}`);
console.log(`                  → ${outputPath} (scale=${scale}, page=${page})`);
const result = spawnSync(
  "drawio-ai",
  ["render", inputPath, "-o", outputPath, "--scale", String(scale), "--page", String(page)],
  { stdio: "inherit", env: { ...process.env, DRAWIO_CLI: drawioCli } },
);
if (result.status !== 0) die(3, `drawio-ai render exited ${result.status}`);

if (!existsSync(outputPath)) die(3, `render reported success but ${outputPath} was not created`);
const outStat = statSync(outputPath);
if (outStat.size === 0) die(3, `render produced an empty file at ${outputPath}`);
console.log(`drawio-export-png: wrote ${outputPath} (${outStat.size} bytes)`);
process.exit(0);