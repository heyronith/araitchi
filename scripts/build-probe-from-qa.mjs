#!/usr/bin/env node
/**
 * Build probe eval labels from GPQA-style items (optional OpenRouter run).
 * Writes evals/probe/gpqa-derived.json (≥200 items when --count 200).
 *
 * Without OPENROUTER_API_KEY, writes deterministic placeholder items from templates
 * so eval:probe can load the file structure offline.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "evals/probe/gpqa-derived.json");

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.join(root, ".env.local");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const args = process.argv.slice(2);
let count = 200;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--count" && args[i + 1]) count = Number(args[++i]) || 200;
}

const MODEL_A = process.env.PROBE_MODEL_A ?? "~anthropic/claude-haiku-latest";
const MODEL_B = process.env.PROBE_MODEL_B ?? "~google/gemini-flash-latest";

const TEMPLATES = [
  {
    q: "Which particle carries the strong nuclear force? A) Gluon B) Photon C) W boson D) Electron. Answer with letter only.",
    truth: "A",
  },
  {
    q: "What is the chemical symbol for gold? A) Au B) Ag C) Go D) Gd. Letter only.",
    truth: "A",
  },
  {
    q: "Speed of light in vacuum (approx)? A) 3×10^8 m/s B) 3×10^6 m/s C) 3×10^4 m/s D) 3×10^2 m/s. Letter only.",
    truth: "A",
  },
  {
    q: "DNA base not in standard four? A) Uracil (in RNA) B) Adenine C) Guanine D) Cytosine. Letter only.",
    truth: "A",
  },
];

function letterFromAnswer(text) {
  const m = text.trim().match(/\b([A-D])\b/i);
  return m ? m[1].toUpperCase() : null;
}

async function ask(apiKey, model, question) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 64,
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

async function main() {
  mkdirSync(path.dirname(outPath), { recursive: true });
  const apiKey = loadKey();
  const items = [];

  for (let i = 0; i < count; i++) {
    const t = TEMPLATES[i % TEMPLATES.length];
    const variant = `${t.q} (item ${i})`;
    const id = `gpqa-derived-${i}`;

    if (!apiKey) {
      items.push({
        id,
        question: variant,
        expectAgreement: i % 3 !== 0,
        notes:
          "template placeholder — run with OPENROUTER_API_KEY for live labels",
      });
      continue;
    }

    try {
      const [a, b] = await Promise.all([
        ask(apiKey, MODEL_A, variant),
        ask(apiKey, MODEL_B, variant),
      ]);
      const la = letterFromAnswer(a);
      const lb = letterFromAnswer(b);
      const agree = la !== null && la === lb;
      const bothWrong =
        la !== null && lb !== null && la !== t.truth && lb !== t.truth;
      items.push({
        id,
        question: variant,
        expectAgreement: agree && !bothWrong,
        notes: `truth=${t.truth} A=${la} B=${lb}`,
      });
      if ((i + 1) % 10 === 0) console.log(`built ${i + 1}/${count}`);
    } catch (e) {
      console.error(id, e instanceof Error ? e.message : e);
      items.push({
        id,
        question: variant,
        expectAgreement: true,
        notes: "error during label build",
      });
    }
  }

  writeFileSync(outPath, JSON.stringify(items, null, 2) + "\n");
  const h = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  console.log(
    `Wrote ${items.length} items → ${outPath} (sha256 ${h.slice(0, 12)}…)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
