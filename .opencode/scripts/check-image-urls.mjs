import { createServer } from "node:http";

const TIMEOUT = 8000;
const CONCURRENCY = 5;

async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(timer);

    if (res.status === 405) {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), TIMEOUT);
      const res2 = await fetch(url, { method: "GET", signal: controller2.signal });
      clearTimeout(timer2);
      const ok = res2.ok && res2.status < 400;
      return { url, valid: ok, status: res2.status };
    }

    return { url, valid: res.ok && res.status < 400, status: res.status };
  } catch {
    return { url, valid: false, status: 0 };
  }
}

async function checkBatch(urls) {
  const results = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkUrl));
    results.push(...batchResults);
  }
  return results;
}

const input = process.argv[2] || "";
let urls;

try {
  urls = JSON.parse(input);
} catch {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    urls = JSON.parse(Buffer.concat(chunks).toString().trim());
  } catch {
    process.stderr.write("Usage: provide JSON array of URLs as argument or via stdin\n");
    process.exit(1);
  }
}

if (!Array.isArray(urls)) {
  process.stderr.write("Input must be a JSON array of URL strings\n");
  process.exit(1);
}

const results = await checkBatch(urls);
const valid = results.filter((r) => r.valid).map((r) => r.url);
const invalid = results.filter((r) => !r.valid).map((r) => ({ url: r.url, status: r.status }));

process.stdout.write(JSON.stringify({ valid, invalid, all: results }, null, 2));
