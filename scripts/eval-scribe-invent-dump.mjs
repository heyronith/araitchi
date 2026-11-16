#!/usr/bin/env node
/**
 * Dump every "invented" scribe create for manual a/b/c classification.
 *   (a) quote ok but claim overstates/distorts
 *   (b) grounded correct extra missing from gold
 *   (c) quote check not applied (ungrounded still counted)
 *
 * Usage: pnpm exec node scripts/eval-scribe-invent-dump.mjs [model…]
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

const MODELS =
  process.argv.slice(2).filter((a) => !a.startsWith("-")).length > 0
    ? process.argv.slice(2).filter((a) => !a.startsWith("-"))
    : [
        "~openai/gpt-latest",
        "~google/gemini-flash-latest",
        "~anthropic/claude-sonnet-latest",
      ];

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.join(root, ".env.local");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
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

function normalizeEvidence(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function quoteOk(quote, source) {
  const q = normalizeEvidence(quote ?? "");
  return q.length >= 8 && normalizeEvidence(source).includes(q);
}

function matchesGold(create, expectedTypes) {
  return expectedTypes.find(
    (e) =>
      e.type === create.type &&
      (e.titleTerms ?? []).every((t) =>
        String(create.title + " " + create.body)
          .toLowerCase()
          .includes(String(t).toLowerCase()),
      ),
  );
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
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error("No OPENROUTER_API_KEY");
    process.exit(1);
  }
  const system = readFileSync(
    path.join(root, "src/lib/server/prompts/scribe.md"),
    "utf8",
  );
  const files = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const inventeds = [];
  let totalCreates = 0;
  let ungroundedDropped = 0;

  for (const model of MODELS) {
    console.error(`[dump] model=${model}`);
    for (const file of files) {
      const fixture = JSON.parse(
        readFileSync(path.join(fixturesDir, file), "utf8"),
      );
      const source = `${fixture.user ?? ""}\n${fixture.reply ?? ""}`;
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
      let actual;
      try {
        const text = await callModel(apiKey, model, system, user);
        actual = extractJson(text) ?? { create: [], update: [] };
      } catch (e) {
        console.error(`  ${file}: ${e.message}`);
        continue;
      }
      const expected = fixture.expected?.records ?? [];
      for (const c of actual.create ?? []) {
        totalCreates += 1;
        const grounded = quoteOk(c.evidenceQuote, source);
        if (!grounded) {
          ungroundedDropped += 1;
          inventeds.push({
            model,
            fixture: file,
            categoryHint: "c_ungrounded",
            create: c,
            expected,
            source,
            note: "quote not in source — should be dropped before invent scoring",
          });
          continue;
        }
        if (!matchesGold(c, expected)) {
          inventeds.push({
            model,
            fixture: file,
            categoryHint: "a_or_b",
            create: c,
            expected,
            source,
            note: "quote grounded but not matched to gold",
          });
        }
      }
    }
  }

  const outDir = path.join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "scribe-invent-dump.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        models: MODELS,
        totalCreates,
        ungroundedCount: ungroundedDropped,
        inventedOrUngrounded: inventeds.length,
        cases: inventeds,
      },
      null,
      2,
    ),
  );
  console.log(
    `Wrote ${outPath} (${inventeds.length} cases; ungrounded=${ungroundedDropped}; creates=${totalCreates})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
