#!/usr/bin/env node
/**
 * Probe agreement eval. Usage: pnpm eval:probe [modelA modelB]
 * Needs OPENROUTER_API_KEY. Writes evals/results/probe.md
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturesPath = path.join(root, "evals/probe/fixtures.json");
const gpqaPath = path.join(root, "evals/probe/gpqa-derived.json");

function loadFixtures() {
  const base = JSON.parse(readFileSync(fixturesPath, "utf8"));
  if (!existsSync(gpqaPath)) return base;
  const derived = JSON.parse(readFileSync(gpqaPath, "utf8"));
  const seen = new Set(base.map((f) => f.id));
  const merged = [...base];
  for (const row of derived) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const MODEL_A = args[0] || "~anthropic/claude-haiku-latest";
const MODEL_B = args[1] || "~google/gemini-flash-latest";

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.join(root, ".env.local");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function fakeEmbed(text, dims = 32) {
  const out = new Float32Array(dims);
  const h = createHash("sha256").update(text.toLowerCase().trim()).digest();
  for (let i = 0; i < dims; i++) {
    out[i] = ((h[i % h.length] / 255) * 2 - 1) * (1 + (i % 7) * 0.01);
  }
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const t of tokens) {
    let s = 0;
    for (let i = 0; i < t.length; i++) s = (s * 31 + t.charCodeAt(i)) >>> 0;
    out[s % dims] += 1.5;
  }
  let norm = Math.sqrt(out.reduce((a, b) => a + b * b, 0)) || 1;
  for (let i = 0; i < dims; i++) out[i] /= norm;
  return out;
}

function cosine(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
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
      max_tokens: 256,
      messages: [
        {
          role: "system",
          content: "Answer briefly. End with confidence: 0.0-1.0",
        },
        { role: "user", content: question },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY required");
    process.exit(1);
  }
  const fixtures = loadFixtures();
  const scores = [];
  for (const f of fixtures) {
    try {
      const [a, b] = await Promise.all([
        ask(apiKey, MODEL_A, f.question),
        ask(apiKey, MODEL_B, f.question),
      ]);
      const agreement = cosine(fakeEmbed("doc:" + a), fakeEmbed("doc:" + b));
      scores.push({
        id: f.id,
        expectAgreement: f.expectAgreement,
        agreement,
      });
      console.log(
        f.id,
        "agree=",
        agreement.toFixed(3),
        "expect=",
        f.expectAgreement,
      );
    } catch (e) {
      console.error(f.id, e.message);
      scores.push({
        id: f.id,
        expectAgreement: f.expectAgreement,
        agreement: 0,
      });
    }
  }

  // ROC-ish: try thresholds
  const thresholds = [];
  for (let t = 0.4; t <= 0.95; t += 0.02) {
    let tp = 0,
      fp = 0,
      tn = 0,
      fn = 0;
    for (const s of scores) {
      const pred = s.agreement >= t;
      if (s.expectAgreement && pred) tp++;
      else if (!s.expectAgreement && pred) fp++;
      else if (!s.expectAgreement && !pred) tn++;
      else fn++;
    }
    const tpr = tp + fn ? tp / (tp + fn) : 0;
    const fpr = fp + tn ? fp / (fp + tn) : 0;
    const acc = (tp + tn) / scores.length;
    thresholds.push({ t: +t.toFixed(2), tpr, fpr, acc, tp, fp, tn, fn });
  }
  thresholds.sort((a, b) => b.acc - a.acc || b.tpr - a.tpr);
  const best = thresholds[0];

  const lines = [
    "# Probe agreement eval",
    "",
    `Models: ${MODEL_A} × ${MODEL_B}`,
    `Fixtures: ${fixtures.length}`,
    "",
    `Chosen threshold: **${best.t}** (accuracy ${(best.acc * 100).toFixed(1)}%, TPR ${(best.tpr * 100).toFixed(1)}%, FPR ${(best.fpr * 100).toFixed(1)}%)`,
    "",
    "| Threshold | Acc | TPR | FPR |",
    "| ---: | ---: | ---: | ---: |",
  ];
  for (const row of thresholds.filter((_, i) => i % 2 === 0).slice(0, 12)) {
    lines.push(
      `| ${row.t} | ${(row.acc * 100).toFixed(0)}% | ${(row.tpr * 100).toFixed(0)}% | ${(row.fpr * 100).toFixed(0)}% |`,
    );
  }

  const outDir = path.join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "probe.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
