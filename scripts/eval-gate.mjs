#!/usr/bin/env node
/**
 * Gate classifier eval. Usage: pnpm eval:gate [llmModel…]
 * Compares: difficulty baseline, kNN-only, kNN+LLM candidates, LLM-only.
 * Needs OPENROUTER_API_KEY for LLM legs. Writes evals/results/gate.md
 */
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const evalDir = path.join(root, "evals/gate");
const seedPath = path.join(root, "src/lib/server/gate/seed-examples.json");

const DEFAULT_MODELS = [
  "~openai/gpt-oss-latest",
  "~google/gemini-flash-latest",
  "~anthropic/claude-haiku-latest",
];
const MODELS =
  process.argv.slice(2).filter((a) => !a.startsWith("-")).length > 0
    ? process.argv.slice(2).filter((a) => !a.startsWith("-"))
    : DEFAULT_MODELS;

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.join(root, ".env.local");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function loadEvals() {
  const files = readdirSync(evalDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const out = [];
  for (const f of files) {
    const chunk = JSON.parse(readFileSync(path.join(evalDir, f), "utf8"));
    out.push(...(Array.isArray(chunk) ? chunk : [chunk]));
  }
  return out;
}

function difficultyBaseline(text) {
  const t = text.toLowerCase();
  if (t.length < 20 && /hi|hey|thanks/.test(t)) return "chat";
  if (/hypothesis|hypotheses/.test(t)) return "hypothesis_generation";
  if (/experiment|protocol|a\/b/.test(t)) return "experiment_design";
  if (/literature|survey|novelty|papers?\b/.test(t)) return "literature_review";
  if (/critique|weakness|flaw/.test(t)) return "critique";
  if (/doi|define|what is|citation|arxiv/.test(t)) return "factual_lookup";
  if (/git|commit|repo/.test(t)) return "repo_status";
  if (/fix|code|typescript|python|bug/.test(t)) return "code_help";
  if (/summar|tl;dr|condense/.test(t)) return "summarize_single";
  if (/format|markdown|bullet|table/.test(t)) return "formatting";
  return "other";
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

function knnPredict(text, seeds, k = 7) {
  const q = fakeEmbed("query:" + text);
  const scored = seeds
    .map((s) => ({
      taskType: s.taskType,
      score: cosine(q, s.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  const weights = new Map();
  let total = 0;
  for (const n of scored) {
    const w = Math.max(0, n.score);
    weights.set(n.taskType, (weights.get(n.taskType) ?? 0) + w);
    total += w;
  }
  let best = "other";
  let bestW = -1;
  for (const [t, w] of weights) {
    if (w > bestW) {
      bestW = w;
      best = t;
    }
  }
  return { taskType: best, confidence: total ? bestW / total : 0 };
}

async function llmClassify(apiKey, model, text) {
  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            'Classify the user message. Reply ONLY JSON {"taskType":"…","stakes":"low|medium|high","needsEvidence":bool,"reason":"…"}',
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
    }),
  });
  const latency = Date.now() - t0;
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  const parsed = JSON.parse(content.slice(start, end + 1));
  return {
    taskType: parsed.taskType,
    latency,
    cost: json.usage?.cost ?? null,
  };
}

function metrics(yTrue, yPred, alwaysCouncil) {
  let correct = 0;
  const labels = [...new Set([...yTrue, ...yPred])];
  const conf = Object.fromEntries(
    labels.map((a) => [a, Object.fromEntries(labels.map((b) => [b, 0]))]),
  );
  for (let i = 0; i < yTrue.length; i++) {
    conf[yTrue[i]][yPred[i]] += 1;
    if (yTrue[i] === yPred[i]) correct += 1;
  }
  const f1 = {};
  for (const lab of labels) {
    let tp = conf[lab][lab];
    let fp = 0;
    let fn = 0;
    for (const o of labels) {
      if (o !== lab) {
        fp += conf[o][lab];
        fn += conf[lab][o];
      }
    }
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    f1[lab] = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  }
  let acHit = 0;
  let acTot = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (alwaysCouncil.has(yTrue[i])) {
      acTot += 1;
      if (alwaysCouncil.has(yPred[i])) acHit += 1;
    }
  }
  return {
    accuracy: correct / yTrue.length,
    alwaysCouncilRecall: acTot ? acHit / acTot : 1,
    f1,
    conf,
  };
}

async function main() {
  const examples = loadEvals();
  const seedsRaw = JSON.parse(readFileSync(seedPath, "utf8"));
  const seedIds = new Set(examples.map((e) => e.text));
  const seeds = seedsRaw
    .filter((s) => !seedIds.has(s.text))
    .map((s) => ({ ...s, vector: fakeEmbed("doc:" + s.text) }));

  const alwaysCouncil = new Set([
    "hypothesis_generation",
    "experiment_design",
    "literature_review",
    "critique",
    "results_interpretation",
  ]);
  const yTrue = examples.map((e) => e.taskType);

  const rows = [];

  // baseline
  {
    const pred = examples.map((e) => difficultyBaseline(e.text));
    const m = metrics(yTrue, pred, alwaysCouncil);
    rows.push({
      name: "difficulty baseline",
      ...m,
      latencyMs: 0,
      cost: 0,
    });
  }

  // knn only
  {
    const pred = examples.map((e) => knnPredict(e.text, seeds).taskType);
    const m = metrics(yTrue, pred, alwaysCouncil);
    rows.push({ name: "kNN only", ...m, latencyMs: 0, cost: 0 });
  }

  const apiKey = loadKey();
  if (!apiKey) {
    console.warn("No OPENROUTER_API_KEY — skipping LLM legs.");
  } else {
    for (const model of MODELS) {
      const preds = [];
      const lat = [];
      let costSum = 0;
      let costN = 0;
      for (const ex of examples) {
        const knn = knnPredict(ex.text, seeds);
        if (knn.confidence >= 0.55) {
          preds.push(knn.taskType);
          lat.push(5);
          continue;
        }
        try {
          const r = await llmClassify(apiKey, model, ex.text);
          preds.push(r.taskType);
          lat.push(r.latency);
          if (typeof r.cost === "number") {
            costSum += r.cost;
            costN += 1;
          }
        } catch {
          preds.push(knn.taskType);
          lat.push(0);
        }
      }
      const m = metrics(yTrue, preds, alwaysCouncil);
      lat.sort((a, b) => a - b);
      rows.push({
        name: `kNN + ${model}`,
        ...m,
        latencyMs: lat[Math.floor(lat.length / 2)] ?? 0,
        cost: costN ? costSum / costN : null,
      });
    }
    for (const model of MODELS.slice(0, 1)) {
      const preds = [];
      const lat = [];
      for (const ex of examples) {
        try {
          const r = await llmClassify(apiKey, model, ex.text);
          preds.push(r.taskType);
          lat.push(r.latency);
        } catch {
          preds.push("other");
          lat.push(0);
        }
      }
      const m = metrics(yTrue, preds, alwaysCouncil);
      lat.sort((a, b) => a - b);
      rows.push({
        name: `LLM only ${model}`,
        ...m,
        latencyMs: lat[Math.floor(lat.length / 2)] ?? 0,
        cost: null,
      });
    }
  }

  const lines = [
    "# Gate classifier eval",
    "",
    `Examples: ${examples.length} (held-out). Seeds: ${seeds.length}.`,
    "",
    "| Method | Accuracy | Always-council recall | Median latency | Cost/call |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${(r.accuracy * 100).toFixed(1)}% | ${(r.alwaysCouncilRecall * 100).toFixed(1)}% | ${r.latencyMs}ms | ${r.cost == null ? "—" : "$" + r.cost.toFixed(4)} |`,
    );
  }
  lines.push("");
  lines.push(
    "Target: accuracy ≥ 85%, always-council recall ≥ 95%. Pick the most accurate LLM with median latency ≤ 3s for `gate.classifierModel`.",
  );

  const outDir = path.join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "gate.md");
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log("\nWrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
