#!/usr/bin/env node
/**
 * Manual scribe quality eval. Uses the real OpenRouter key.
 * Usage: pnpm eval:scribe [modelA modelB modelC…]
 *
 * Applies production filters: evidence quote in source + claim entailed by quote.
 * Invented creates are split into:
 *   (a) quote ok but claim overstates (failed entailment — dropped, counted)
 *   (b) grounded+entailed but missing from gold (labeling gap)
 *   (c) quote check would not apply (ungrounded — dropped; should be ~0 in score)
 *
 * Scores precision/recall on kept creates; target real invented (b after gold fixes,
 * residual a that slipped entailment) ≤ 2% with recall ≥ 85%.
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

// Pure JS copies of evidence checks (avoid server-only imports in this script).
function normalizeEvidence(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(
  "the a an and or but if then with without from into onto over under about above below after before between during for of on to in at by as is are was were be been being this that these those it its they them we you your our their not no yes do does did done have has had can could should would may might will just only also more most such than so very into".split(
    " ",
  ),
);

function lightStem(token) {
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function contentTokens(text) {
  return normalizeEvidence(text)
    .replace(/[^a-z0-9\s>-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP.has(t))
    .map(lightStem);
}

function evidenceQuoteInSource(quote, sourceText) {
  const q = normalizeEvidence(quote);
  if (q.length < 8) return false;
  return normalizeEvidence(sourceText).includes(q);
}

function claimEntailedByQuote({ title, body, quote }) {
  const quoteToks = new Set(contentTokens(quote));
  if (quoteToks.size === 0) return false;
  const titleToks = contentTokens(title);
  if (titleToks.length === 0) return false;
  const titleHit = titleToks.filter((t) => quoteToks.has(t)).length;
  if (titleHit / titleToks.length < 0.5) return false;
  const b = String(body ?? "").trim();
  if (!b) return true;
  const bodyToks = contentTokens(b);
  if (bodyToks.length === 0) return true;
  const bodyHit = bodyToks.filter((t) => quoteToks.has(t)).length;
  return bodyHit / bodyToks.length >= 0.4;
}

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

function typeOk(expected, create) {
  if (expected.type === create.type) return true;
  return (expected.altTypes ?? []).includes(create.type);
}

function matchesGold(create, expectedTypes) {
  return expectedTypes.find(
    (e) =>
      typeOk(e, create) &&
      (e.titleTerms ?? []).every((t) =>
        String(create.title + " " + create.body)
          .toLowerCase()
          .includes(String(t).toLowerCase()),
      ),
  );
}

function scoreFixture(expected, actual, fixture) {
  const source = `${fixture.user ?? ""}\n${fixture.reply ?? ""}`;
  const expectedTypes = expected.records ?? [];
  const rawCreates = actual?.create ?? [];

  let catA = 0; // overstatement (failed entailment)
  let catB = 0; // grounded+entailed, not in gold
  let catC = 0; // ungrounded quote
  const kept = [];

  for (const c of rawCreates) {
    if (!evidenceQuoteInSource(c.evidenceQuote ?? "", source)) {
      catC += 1;
      continue;
    }
    if (
      !claimEntailedByQuote({
        title: c.title ?? "",
        body: c.body ?? "",
        quote: c.evidenceQuote ?? "",
      })
    ) {
      catA += 1;
      continue;
    }
    kept.push(c);
  }

  let tp = 0;
  for (const c of kept) {
    if (matchesGold(c, expectedTypes)) tp += 1;
    else catB += 1;
  }

  const precision = kept.length ? tp / kept.length : 1;
  const recall = expectedTypes.length ? tp / expectedTypes.length : 1;
  const duplicateRate =
    kept.length <= 1
      ? 0
      : 1 - new Set(kept.map((c) => `${c.type}:${c.title}`)).size / kept.length;
  // Real invented = category (b) among kept (a/c already dropped)
  const inventedRate = kept.length ? catB / kept.length : 0;

  return {
    precision,
    recall,
    duplicateRate,
    inventedRate,
    catA,
    catB,
    catC,
    kept: kept.length,
    raw: rawCreates.length,
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
    let sumA = 0,
      sumB = 0,
      sumC = 0,
      sumRaw = 0;
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
        const s = scoreFixture(fixture.expected, actual, fixture);
        scores.push(s);
        sumA += s.catA;
        sumB += s.catB;
        sumC += s.catC;
        sumRaw += s.raw;
      } catch (e) {
        console.error(`  ${model} / ${file}: ${e.message}`);
        scores.push({
          precision: 0,
          recall: 0,
          duplicateRate: 1,
          inventedRate: 1,
          catA: 0,
          catB: 0,
          catC: 0,
          kept: 0,
          raw: 0,
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
      catA: sumA,
      catB: sumB,
      catC: sumC,
      raw: sumRaw,
    });
  }

  const lines = [
    "# Scribe eval",
    "",
    `Fixtures: ${files.length}. Models: ${MODELS.join(", ")}.`,
    "",
    "Filters: evidence quote ∈ source + claim entailed by quote (production path).",
    "",
    "| Model | Precision | Recall | Dup rate | Invented (b) | Cost/reply | (a) overstate | (b) gold-gap | (c) ungrounded |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.model} | ${(r.precision * 100).toFixed(0)}% | ${(r.recall * 100).toFixed(0)}% | ${(r.duplicateRate * 100).toFixed(0)}% | ${(r.inventedRate * 100).toFixed(0)}% | ${r.costPerReply == null ? "—" : "$" + r.costPerReply.toFixed(4)} | ${r.catA} | ${r.catB} | ${r.catC} |`,
    );
  }
  lines.push(
    "",
    "Invented categories (counts over all fixtures):",
    "- **(a)** quote verified but claim failed entailment → dropped before score",
    "- **(b)** grounded+entailed but not in gold (real invent / labeling gap)",
    "- **(c)** quote not in source → dropped (eval bug if these were scored as invent)",
  );
  const outDir = path.join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "scribe.md");
  writeFileSync(outPath, lines.join("\n") + "\n");
  writeFileSync(
    path.join(outDir, "scribe-invent-split.json"),
    JSON.stringify({ rows }, null, 2),
  );
  console.log(lines.join("\n"));
  console.log("\nWrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
