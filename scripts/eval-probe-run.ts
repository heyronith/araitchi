/**
 * Probe agreement eval with structured finalAnswer comparison.
 * Usage via scripts/eval-probe.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  extractProbeStructure,
  keyClaimOverlap,
  normalizeFinalAnswer,
  scoreStructuredAgreement,
  type ProbeStructure,
} from "../src/lib/server/gate/probe";
import { loadDefaults } from "../src/lib/server/defaults";

const root = process.cwd();
const fixturesPath = path.join(root, "evals/probe/fixtures.json");
const gpqaPath = path.join(root, "evals/probe/gpqa-derived.json");
const outDir = path.join(root, "evals/results");

type Fixture = {
  id: string;
  question: string;
  expectAgreement: boolean;
  notes?: string;
};

function loadKey(): string | null {
  if (process.env.OPENROUTER_API_KEY?.trim())
    return process.env.OPENROUTER_API_KEY.trim();
  const envPath = path.join(root, ".env.local");
  if (!existsSync(envPath)) return null;
  const m = readFileSync(envPath, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
  return m?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
}

function loadFixtures(): Fixture[] {
  const base = JSON.parse(readFileSync(fixturesPath, "utf8")) as Fixture[];
  if (!existsSync(gpqaPath)) return base;
  const derived = JSON.parse(readFileSync(gpqaPath, "utf8")) as Fixture[];
  const seen = new Set(base.map((f) => f.id));
  const merged = [...base];
  for (const row of derived) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

async function ask(
  apiKey: string,
  model: string,
  question: string,
): Promise<string> {
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
          content:
            "Answer briefly. For multiple choice, state the letter (A-D) clearly. End with confidence: 0.0-1.0",
        },
        { role: "user", content: question },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

function letterFromAnswer(text: string): string | null {
  const m = normalizeFinalAnswer(text).match(/^([A-D])$/);
  return m ? m[1]! : null;
}

function parseTruth(notes?: string): string | null {
  const m = notes?.match(/truth=(\w+)/);
  return m?.[1] ?? null;
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY required");
    process.exit(1);
  }
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const MODEL_A = args[0] || "~anthropic/claude-haiku-latest";
  const MODEL_B = args[1] || "~google/gemini-flash-latest";
  const extractModel =
    loadDefaults().paperEnhanceModel || "~google/gemini-flash-latest";
  const fixtures = loadFixtures();
  const gpqaOnly = fixtures.filter((f) => f.id.startsWith("gpqa-derived-"));
  const set = gpqaOnly.length >= 200 ? gpqaOnly : fixtures;

  console.error(
    `[probe] n=${set.length} structured-compare extract=${extractModel} models=${MODEL_A} × ${MODEL_B}`,
  );

  const scores: {
    id: string;
    expectAgreement: boolean;
    agreement: number;
    bothWrongAgree: boolean;
    finalA: string;
    finalB: string;
  }[] = [];

  for (const f of set) {
    try {
      const [rawA, rawB] = await Promise.all([
        ask(apiKey, MODEL_A, f.question),
        ask(apiKey, MODEL_B, f.question),
      ]);
      const [exA, exB] = await Promise.all([
        extractProbeStructure({
          apiKey,
          modelId: extractModel,
          answerText: rawA,
        }),
        extractProbeStructure({
          apiKey,
          modelId: extractModel,
          answerText: rawB,
        }),
      ]);
      const sa: ProbeStructure = exA.structure;
      const sb: ProbeStructure = exB.structure;
      const agreement = scoreStructuredAgreement(sa, sb);
      const truth = parseTruth(f.notes);
      const la = letterFromAnswer(sa.finalAnswer) ?? letterFromAnswer(rawA);
      const lb = letterFromAnswer(sb.finalAnswer) ?? letterFromAnswer(rawB);
      const bothWrongAgree =
        Boolean(truth) && la != null && lb != null && la === lb && la !== truth;
      scores.push({
        id: f.id,
        expectAgreement: f.expectAgreement,
        agreement,
        bothWrongAgree,
        finalA: normalizeFinalAnswer(sa.finalAnswer),
        finalB: normalizeFinalAnswer(sb.finalAnswer),
      });
      console.log(
        f.id,
        "agree=",
        agreement.toFixed(3),
        "A=",
        normalizeFinalAnswer(sa.finalAnswer),
        "B=",
        normalizeFinalAnswer(sb.finalAnswer),
        "overlap=",
        keyClaimOverlap(sa.keyClaims, sb.keyClaims).toFixed(2),
        "expect=",
        f.expectAgreement,
        bothWrongAgree ? "AGREE_BUT_WRONG" : "",
      );
    } catch (e) {
      console.error(f.id, e instanceof Error ? e.message : e);
      scores.push({
        id: f.id,
        expectAgreement: f.expectAgreement,
        agreement: 0,
        bothWrongAgree: false,
        finalA: "",
        finalB: "",
      });
    }
  }

  // Binary decision: agreement > 0 means finals matched
  const predAgree = (s: (typeof scores)[0]) => s.agreement > 0;
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0,
    abw = 0,
    predN = 0;
  for (const s of scores) {
    const pred = predAgree(s);
    if (pred) {
      predN += 1;
      if (s.bothWrongAgree) abw += 1;
    }
    if (s.expectAgreement && pred) tp++;
    else if (!s.expectAgreement && pred) fp++;
    else if (!s.expectAgreement && !pred) tn++;
    else fn++;
  }
  const tpr = tp + fn ? tp / (tp + fn) : 0;
  const fpr = fp + tn ? fp / (fp + tn) : 0;
  const acc = (tp + tn) / Math.max(1, scores.length);
  const abwRate = predN ? abw / predN : 0;

  const pass = acc >= 0.85 && abwRate <= 0.05;
  const decision = pass
    ? "SHIP structured probe (finalAnswer match)"
    : "DISABLE probe — route other/uncertain to council";

  const lines = [
    "# Probe agreement eval (structured finalAnswer)",
    "",
    `Models: ${MODEL_A} × ${MODEL_B}`,
    `Extractor: ${extractModel}`,
    `Fixtures: ${scores.length} (GPQA-derived preferred)`,
    "",
    `Accuracy: **${(acc * 100).toFixed(1)}%** (TPR ${(tpr * 100).toFixed(1)}%, FPR ${(fpr * 100).toFixed(1)}%)`,
    `Agree-but-wrong: **${(abwRate * 100).toFixed(1)}%** (${abw}/${predN || 0} predicted agrees)`,
    "",
    `Decision: **${decision}**`,
    `PROBE_ENABLED=${pass ? "1" : "0"}`,
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Accuracy | ${(acc * 100).toFixed(1)}% |`,
    `| TPR | ${(tpr * 100).toFixed(1)}% |`,
    `| FPR | ${(fpr * 100).toFixed(1)}% |`,
    `| Agree-but-wrong | ${(abwRate * 100).toFixed(1)}% |`,
    `| Exact final match rate | ${((scores.filter((s) => s.finalA && s.finalA === s.finalB).length / Math.max(1, scores.length)) * 100).toFixed(1)}% |`,
  ];

  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "probe.md"), lines.join("\n") + "\n");
  writeFileSync(
    path.join(outDir, "probe-structured.json"),
    JSON.stringify(
      {
        acc,
        tpr,
        fpr,
        abwRate,
        pass,
        probeEnabled: pass,
        n: scores.length,
      },
      null,
      2,
    ),
  );
  console.log(lines.join("\n"));
  console.log("PROBE_ENABLED=" + (pass ? "1" : "0"));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
