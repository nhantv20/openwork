#!/usr/bin/env bun
/**
 * Quick test for fpt-proxy. Verifies:
 *  1) Pass-through works against a real FPT key
 *  2) Stats endpoint counts correctly
 *  3) Throttle returns 429 + retry-after when limits are exceeded
 *  4) Dashboard HTML is served
 */
const BASE = process.env.FPT_PROXY_BASE ?? "http://127.0.0.1:8789";
const KEY = process.env.FPT_API_KEY;

if (!KEY) {
  console.error("FPT_API_KEY env var is required");
  process.exit(1);
}

async function chat(model: string, prompt: string) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${KEY}`,
      "content-type": "application/json",
      "accept-encoding": "identity",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 16,
    }),
  });
  return { status: r.status, body: await r.text(), headers: Object.fromEntries(r.headers) };
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
}

console.log("→ health");
const h = await fetch(`${BASE}/__health`);
check("health 200", h.status === 200);

console.log("→ dashboard");
const dash = await fetch(`${BASE}/__dashboard`);
check("dashboard 200 html", dash.status === 200 && (await dash.text()).includes("fpt-proxy"));

console.log("→ reset counters");
const reset = await fetch(`${BASE}/__reset`, { method: "POST" });
check("reset 200", reset.status === 200);

console.log("→ pass-through single call");
const one = await chat("DeepSeek-V4-Flash", "Reply with the single word: PONG");
check("single call 200", one.status === 200, `status=${one.status} body=${one.body.slice(0, 200)}`);

console.log("→ stats reflect one request");
const s1 = await (await fetch(`${BASE}/__stats`)).json();
check("stats reqs>=1", s1.last_60s.reqs >= 1, JSON.stringify(s1.last_60s));
check("stats has model row", s1.by_model_60s.length > 0);
check("stats has tokens", s1.last_60s.tokens > 0);

console.log("→ set tight throttle (rpm=1, tpm=10) then burst");
await fetch(`${BASE}/__config`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ rpm: 1, tpm: 10, burst: 1 }),
});
const burst = await Promise.all(Array.from({ length: 4 }, () => chat("DeepSeek-V4-Flash", "hi")));
const throttled = burst.filter(r => r.status === 429);
const passed = burst.filter(r => r.status === 200 || r.status === 502);
check("burst triggers >=1 throttle 429", throttled.length >= 1, `statuses=${burst.map(r => r.status).join(",")}`);
check("throttled has retry-after", throttled.every(r => r.headers["retry-after"]));
check("throttled has x-fpt-proxy-throttled", throttled.every(r => r.headers["x-fpt-proxy-throttled"] === "1"));

console.log("→ restore default throttle");
await fetch(`${BASE}/__config`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ rpm: 30, tpm: 200000, burst: 5 }),
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
