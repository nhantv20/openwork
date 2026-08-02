const KEY = process.env.FPT_API_KEY;
const BASE = process.env.FPT_PROXY_BASE || "http://127.0.0.1:8789";
const systemPrompt = ("You are OpenWork. Help the user work on files safely. ").repeat(800);
const tools = [
  { type: "function", function: { name: "bash", description: "Run a bash command", parameters: { type: "object", properties: { cmd: { type: "string" } } } },
  { type: "function", function: { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
  { type: "function", function: { name: "write", description: "Write a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } },
];

async function main() {
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    const r = await fetch(BASE + "/v1/chat/completions", {
      method: "POST",
      headers: { "authorization": "Bearer " + KEY, "content-type": "application/json", "accept-encoding": "identity" },
      body: JSON.stringify({
        model: "Qwen3.6-27B",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "hi" }],
        max_tokens: 16,
        temperature: 0,
        stream: true,
        tools: tools,
      }),
    });
    const text = await r.text();
    const has500 = text.indexOf("500") !== -1 || text.indexOf("Internal") !== -1;
    console.log("Qwen stream+tools call " + i + ": " + (Date.now() - t0) + "ms status=" + r.status + " len=" + text.length + " has500=" + has500);
    console.log("  first200: " + text.slice(0, 200).replace(/\n/g, " "));
  }
}

main().catch(function (e) { console.error(e); process.exit(1); });
