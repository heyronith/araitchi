#!/usr/bin/env node
/**
 * Manual scribe quality eval. Uses the real OpenRouter key.
 * Usage: pnpm eval:scribe [modelA modelB modelC…]
 *
 * Scores precision, recall, duplicate rate, invented-content rate, and cost.
 * Defaults use OpenRouter "latest" aliases (quality-first).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturesDir = path.join(root, "evals/scribe");

const DEFAULT_MODELS = [
  "~openai/gpt-latest",
  "openai/gpt-oss-20b",
  "~google/gemini-flash-latest",
];
const MODELS =
  process.argv.slice(2).filter((a) => !a.startsWith("-")).length > 0
    ? process.argv.slice(2).filter((a) => !a.startsWith("-"))
    : DEFAULT_MODELS;

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.join(root, ".env.local");
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, "utf8");
    const m = text.match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function scoreFixture(expected, actual) {
  const creates = actual?.create ?? [];
  const expectedTypes = expected.records ?? [];
  let tp = 0;
  let invented = 0;
  for (const c of creates) {
    const match = expectedTypes.find(
      (e) =>
        e.type === c.type &&
        (e.titleTerms ?? []).every((t) =>
          String(c.title + " " + c.body)
            .toLowerCase()
            .includes(String(t).toLowerCase()),
        ),
    );
    if (match) tp += 1;
    else invented += 1;
  }
  const precision = creates.length ? tp / creates.length : 1;
  const recall = expectedTypes.length ? tp / expectedTypes.length : 1;
  const duplicateRate =
    creates.length <= 1
      ? 0
      : 1 -
        new Set(creates.map((c) => `${c.type}:${c.title}`)).size /
          creates.length;
  return {
    precision,
    recall,
    duplicateRate,
    inventedRate: creates.length ? invented / creates.length : 0,
  };
}

async function callModel(apiKey, model, system, user) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      // Cap reservation: unbounded max_tokens (65k) 402s when credit headroom is tight
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  const cost = json.usage?.cost ?? json.usage?.total_cost ?? null;
  return { text, cost };
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error("No OpenRouter API key (OPENROUTER_API_KEY or .env.local).");
    process.exit(1);
  }
  if (!existsSync(fixturesDir)) {
    console.error("Missing evals/scribe fixtures");
    process.exit(1);
  }

  const system = readFileSync(
    path.join(root, "src/lib/server/prompts/scribe.md"),
    "utf8",
  );
  const files = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  console.log(
    `Evaluating ${files.length} fixtures × ${MODELS.length} models\n`,
  );

  const rows = [];
  for (const model of MODELS) {
    const scores = [];
    let costSum = 0;
    let costN = 0;
    for (const file of files) {
      const fixture = JSON.parse(
        readFileSync(path.join(fixturesDir, file), "utf8"),
      );
      const user = [
        "## Last user message",
        fixture.user,
        "",
        "## Assistant reply",
        `<assistant_reply untrusted="true">\n${fixture.reply}\n</assistant_reply>`,
        "",
        "## Existing active records",
        JSON.stringify(fixture.existing ?? []),
      ].join("\n");
      try {
        const { text, cost } = await callModel(apiKey, model, system, user);
        if (typeof cost === "number") {
          costSum += cost;
          costN += 1;
        }
        const actual = extractJson(text) ?? { create: [], update: [] };
        scores.push(scoreFixture(fixture.expected, actual));
      } catch (e) {
        console.error(`  ${model} / ${file}: ${e.message}`);
        scores.push({
          precision: 0,
          recall: 0,
          duplicateRate: 1,
          inventedRate: 1,
        });
      }
    }
    const avg = (k) =>
      scores.reduce((s, x) => s + x[k], 0) / Math.max(1, scores.length);
    rows.push({
      model,
      precision: avg("precision"),
      recall: avg("recall"),
      duplicateRate: avg("duplicateRate"),
      inventedRate: avg("inventedRate"),
      costPerReply: costN ? costSum / costN : null,
    });
  }

  const lines = [
    "# Scribe eval",
    "",
    `Fixtures: ${files.length}. Models: ${MODELS.join(", ")}.`,
    "",
    "| Model | Precision | Recall | Dup rate | Invented | Cost/reply |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.model} | ${(r.precision * 100).toFixed(0)}% | ${(r.recall * 100).toFixed(0)}% | ${(r.duplicateRate * 100).toFixed(0)}% | ${(r.inventedRate * 100).toFixed(0)}% | ${r.costPerReply == null ? "—" : "$" + r.costPerReply.toFixed(4)} |`,
    );
  }
  const outDir = path.join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "scribe.md");
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log("\nWrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
