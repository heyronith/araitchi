#!/usr/bin/env node
/**
 * Manual smoke: OPENROUTER_API_KEY=... pnpm smoke:openrouter
 * Not run in CI.
 */
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("Set OPENROUTER_API_KEY");
  process.exit(1);
}

const base =
  process.env.ARAITCHI_OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

const headers = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "http://127.0.0.1:3000",
  "X-Title": "Araitchi",
};

const modelsRes = await fetch(`${base}/models`, { headers });
if (!modelsRes.ok) {
  console.error("models failed", modelsRes.status);
  process.exit(1);
}
const models = await modelsRes.json();
const list = models.data ?? [];
console.log(`models: ${list.length}`);

const cheap =
  list.find((m) => m.id?.includes("gpt-4o-mini")) ??
  list.find((m) => /flash|mini|haiku|small/i.test(m.id)) ??
  list[0];

if (!cheap) {
  console.error("no model");
  process.exit(1);
}

console.log("using", cheap.id);

const chatRes = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: cheap.id,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
    max_tokens: 16,
    usage: { include: true },
  }),
});

if (!chatRes.ok) {
  console.error("chat failed", chatRes.status, await chatRes.text());
  process.exit(1);
}

const chat = await chatRes.json();
const text = chat.choices?.[0]?.message?.content ?? "";
const cost = chat.usage?.cost ?? chat.usage?.total_cost;
console.log("reply:", text);
console.log("cost:", cost ?? "(unknown)");
