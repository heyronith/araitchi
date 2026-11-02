/**
 * Gate classifier eval using the production embedder + LLM classifier.
 * Usage (via scripts/eval-gate.mjs):
 *   pnpm eval:gate [model…]
 *   pnpm eval:gate --limit 40   # cheaper smoke
 *
 * Writes evals/results/gate.md and evals/results/gate-debug.jsonl
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  classifyKnn,
  clearKnnCache,
  loadSeedExamples,
} from "../src/lib/server/gate/knn";
import { classifyWithLlm } from "../src/lib/server/gate/llm-classify";
import { difficultyBaseline } from "../src/lib/server/gate/rules";
import {
  ALWAYS_COUNCIL,
  actionForTaskType,
  type TaskType,
} from "../src/lib/server/gate/taxonomy";
import {
  getEmbedder,
  shutdownEmbedder,
} from "../src/lib/server/memory/embedder";
import { createOpenRouterClient } from "../src/lib/server/openrouter";

const root = process.cwd();
const evalDir = path.join(root, "evals/gate");
const outDir = path.join(root, "evals/results");
const debugPath = path.join(outDir, "gate-debug.jsonl");

const DEFAULT_MODELS = [
  "~openai/gpt-latest",
  "~google/gemini-flash-latest",
  "~anthropic/claude-haiku-latest",
  "~anthropic/claude-sonnet-latest",
  "openai/gpt-oss-20b",
];

type Example = {
  id: string;
  text: string;
  taskType: TaskType;
  stakes?: string;
  needsEvidence?: boolean;
};

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

function loadKey(): string | null {
  if (process.env.OPENROUTER_API_KEY?.trim())
    return process.env.OPENROUTER_API_KEY.trim();
  const envPath = path.join(root, ".env.local");
  if (!existsSync(envPath)) return null;
  const m = readFileSync(envPath, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m);
  return m?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
}

function loadEvals(): Example[] {
  const files = readdirSync(evalDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const out: Example[] = [];
  for (const f of files) {
    const chunk = JSON.parse(readFileSync(path.join(evalDir, f), "utf8"));
    out.push(...(Array.isArray(chunk) ? chunk : [chunk]));
  }
  return out;
}

async function resolveModels(
  apiKey: string,
  wanted: string[],
): Promise<{ id: string; ok: boolean; note?: string }[]> {
  const openrouter = createOpenRouterClient(apiKey);
  // Catalog via raw fetch (aliases resolve at completion time; check presence)
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const json = (await res.json()) as { data?: { id: string }[] };
  const ids = new Set((json.data ?? []).map((m) => m.id));
  void openrouter;
  return wanted.map((id) => {
    if (ids.has(id)) return { id, ok: true };
    // aliases start with ~ — accept if present or if bare id without ~
    if (id.startsWith("~") && ids.has(id)) return { id, ok: true };
    if (id.startsWith("~"))
      return { id, ok: true, note: "alias (resolve at call)" };
    return { id, ok: false, note: "not in catalog" };
  });
}

type Row = {
  name: string;
  taskAccuracy: number;
  actionAccuracy: number;
  alwaysCouncilRecall: number;
  latencyMs: number;
  cost: number | null;
  parseFailRate: number | null;
  f1: Record<string, number>;
};

function metrics(
  yTrueTask: TaskType[],
  yPredTask: TaskType[],
): Omit<Row, "name" | "latencyMs" | "cost" | "parseFailRate"> {
  const yTrueAct = yTrueTask.map(actionForTaskType);
  const yPredAct = yPredTask.map(actionForTaskType);
  let taskOk = 0;
  let actOk = 0;
  let councilNeed = 0;
  let councilHit = 0;
  const labels = [...new Set([...yTrueTask, ...yPredTask])];
  const conf: Record<string, Record<string, number>> = {};
  for (const a of labels) {
    conf[a] = Object.fromEntries(labels.map((b) => [b, 0]));
  }
  for (let i = 0; i < yTrueTask.length; i++) {
    conf[yTrueTask[i]!]![yPredTask[i]!]! += 1;
    if (yTrueTask[i] === yPredTask[i]) taskOk++;
    if (yTrueAct[i] === yPredAct[i]) actOk++;
    if (ALWAYS_COUNCIL.has(yTrueTask[i]!)) {
      councilNeed++;
      if (yPredAct[i] === "council") councilHit++;
    }
  }
  const f1: Record<string, number> = {};
  for (const lab of labels) {
    const tp = conf[lab]![lab]!;
    let fp = 0;
    let fn = 0;
    for (const o of labels) {
      if (o !== lab) {
        fp += conf[o]![lab]!;
        fn += conf[lab]![o]!;
      }
    }
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    f1[lab] = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  }
  return {
    taskAccuracy: taskOk / yTrueTask.length,
    actionAccuracy: actOk / yTrueTask.length,
    alwaysCouncilRecall: councilNeed ? councilHit / councilNeed : 1,
    f1,
  };
}

async function llmClassifyRaw(
  apiKey: string,
  model: string,
  text: string,
): Promise<{
  taskType: TaskType;
  raw: string;
  parseOk: boolean;
  parseError?: string;
  latency: number;
  cost: number | null;
}> {
  const t0 = Date.now();
  try {
    const r = await classifyWithLlm({ apiKey, modelId: model, text });
    // classifyWithLlm already repairs; detect soft failure via reason prefix
    const parseOk = !r.reason.startsWith("LLM classify failed");
    return {
      taskType: r.taskType,
      raw: JSON.stringify({
        taskType: r.taskType,
        stakes: r.stakes,
        needsEvidence: r.needsEvidence,
        reason: r.reason,
      }),
      parseOk,
      parseError: parseOk ? undefined : r.reason,
      latency: Date.now() - t0,
      cost: r.costUsd,
    };
  } catch (e) {
    return {
      taskType: "other",
      raw: "",
      parseOk: false,
      parseError: e instanceof Error ? e.message : String(e),
      latency: Date.now() - t0,
      cost: null,
    };
  }
}

/** Research-critical keyword safety (mirrors classify.ts). */
export function researchCriticalHint(text: string): boolean {
  return /hypothesis|hypotheses|experiment|protocol|literature|survey|novelty|papers?\b|critique|weakness|flaw|results?\b|interpret/i.test(
    text,
  );
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(debugPath, "");

  const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;
  const modelsArg = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("-") && a !== argValue("--limit"));
  const MODELS = modelsArg.length > 0 ? modelsArg : DEFAULT_MODELS;
  const knnThreshold = 0.55;

  let examples = loadEvals();
  if (limit != null) examples = examples.slice(0, limit);
  const yTrue = examples.map((e) => e.taskType);

  const seedTexts = new Set(examples.map((e) => e.text));
  const seeds = loadSeedExamples().filter((s) => !seedTexts.has(s.text));
  console.error(
    `[gate] examples=${examples.length} seeds=${seeds.length} models=${MODELS.join(",")}`,
  );

  // Production embedder (unless ARAITCHI_FAKE_EMBEDDINGS=1)
  clearKnnCache();
  const embedder = await getEmbedder();
  console.error(`[gate] embedder=${embedder.modelId}`);

  const rows: Row[] = [];

  // Difficulty baseline
  {
    const pred = examples.map((e) => difficultyBaseline(e.text).taskType);
    const m = metrics(yTrue, pred);
    rows.push({
      name: "difficulty baseline",
      ...m,
      latencyMs: 0,
      cost: 0,
      parseFailRate: null,
    });
  }

  // kNN only (real embedder)
  console.error("[gate] embedding seeds + classifying kNN…");
  const knnPreds: TaskType[] = [];
  const knnConfs: number[] = [];
  const tKnn: number[] = [];
  for (const ex of examples) {
    const t0 = Date.now();
    const r = await classifyKnn({
      text: ex.text,
      embedder,
      examples: seeds,
      k: 7,
    });
    knnPreds.push(r.taskType);
    knnConfs.push(r.confidence);
    tKnn.push(Date.now() - t0);
  }
  {
    const m = metrics(yTrue, knnPreds);
    tKnn.sort((a, b) => a - b);
    rows.push({
      name: "kNN only (production embedder)",
      ...m,
      latencyMs: tKnn[Math.floor(tKnn.length / 2)] ?? 0,
      cost: 0,
      parseFailRate: null,
    });
  }

  const apiKey = loadKey();
  if (!apiKey) {
    console.warn("No OPENROUTER_API_KEY — skipping LLM legs.");
  } else {
    const resolved = await resolveModels(apiKey, MODELS);
    for (const r of resolved) {
      console.error(
        `[gate] model ${r.id}: ${r.ok ? "ok" : "MISSING"} ${r.note ?? ""}`,
      );
    }
    const usable = resolved
      .filter((r) => r.ok || r.id.startsWith("~"))
      .map((r) => r.id);

    for (const model of usable) {
      console.error(`[gate] kNN+LLM ${model}`);
      const preds: TaskType[] = [];
      const lats: number[] = [];
      let costSum = 0;
      let costN = 0;
      let parseFail = 0;
      let llmCalls = 0;
      for (let i = 0; i < examples.length; i++) {
        const ex = examples[i]!;
        if (knnConfs[i]! >= knnThreshold) {
          preds.push(knnPreds[i]!);
          lats.push(5);
          continue;
        }
        llmCalls++;
        const r = await llmClassifyRaw(apiKey, model, ex.text);
        preds.push(r.taskType);
        lats.push(r.latency);
        if (!r.parseOk) parseFail++;
        if (typeof r.cost === "number") {
          costSum += r.cost;
          costN++;
        }
        appendFileSync(
          debugPath,
          JSON.stringify({
            model,
            mode: "knn+llm",
            id: ex.id,
            gold: ex.taskType,
            pred: r.taskType,
            parseOk: r.parseOk,
            parseError: r.parseError,
            raw: r.raw.slice(0, 500),
            knnConf: knnConfs[i],
          }) + "\n",
        );
        if ((i + 1) % 20 === 0)
          console.error(
            `[gate] kNN+LLM ${model} (${i + 1}/${examples.length})`,
          );
      }
      const m = metrics(yTrue, preds);
      lats.sort((a, b) => a - b);
      rows.push({
        name: `kNN + ${model}`,
        ...m,
        latencyMs: lats[Math.floor(lats.length / 2)] ?? 0,
        cost: costN ? costSum / costN : null,
        parseFailRate: llmCalls ? parseFail / llmCalls : 0,
      });
    }

    // LLM-only for the first listed model (knn+LLM already covers the rest)
    for (const model of usable.slice(0, 1)) {
      console.error(`[gate] LLM-only ${model}`);
      const preds: TaskType[] = [];
      const lats: number[] = [];
      let costSum = 0;
      let costN = 0;
      let parseFail = 0;
      for (let i = 0; i < examples.length; i++) {
        const ex = examples[i]!;
        const r = await llmClassifyRaw(apiKey, model, ex.text);
        preds.push(r.taskType);
        lats.push(r.latency);
        if (!r.parseOk) parseFail++;
        if (typeof r.cost === "number") {
          costSum += r.cost;
          costN++;
        }
        appendFileSync(
          debugPath,
          JSON.stringify({
            model,
            mode: "llm-only",
            id: ex.id,
            gold: ex.taskType,
            pred: r.taskType,
            parseOk: r.parseOk,
            parseError: r.parseError,
            raw: r.raw.slice(0, 500),
          }) + "\n",
        );
        if ((i + 1) % 20 === 0)
          console.error(
            `[gate] LLM-only ${model} (${i + 1}/${examples.length})`,
          );
      }
      const m = metrics(yTrue, preds);
      lats.sort((a, b) => a - b);
      rows.push({
        name: `LLM only ${model}`,
        ...m,
        latencyMs: lats[Math.floor(lats.length / 2)] ?? 0,
        cost: costN ? costSum / costN : null,
        parseFailRate: parseFail / examples.length,
      });
    }
  }

  const lines = [
    "# Gate classifier eval",
    "",
    `Examples: ${examples.length} (held-out). Seeds: ${seeds.length}. Embedder: \`${embedder.modelId}\`.`,
    "",
    "| Method | Task acc | Action acc | Always-council recall | Median latency | Cost/call | Parse fail |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${(r.taskAccuracy * 100).toFixed(1)}% | ${(r.actionAccuracy * 100).toFixed(1)}% | ${(r.alwaysCouncilRecall * 100).toFixed(1)}% | ${r.latencyMs}ms | ${r.cost == null ? "—" : "$" + r.cost.toFixed(4)} | ${r.parseFailRate == null ? "—" : (r.parseFailRate * 100).toFixed(1) + "%"} |`,
    );
  }

  const best = [...rows].sort((a, b) => b.actionAccuracy - a.actionAccuracy)[0];
  if (best?.f1) {
    lines.push("", "### Per-class F1 (best action-accuracy row)", "");
    lines.push(`Best: **${best.name}**`, "");
    lines.push("| Class | F1 |", "| --- | ---: |");
    for (const [lab, v] of Object.entries(best.f1).sort()) {
      lines.push(`| ${lab} | ${(v * 100).toFixed(1)}% |`);
    }
  }

  lines.push(
    "",
    "Target: **action-level accuracy ≥ 85%**, always-council recall ≥ 95%.",
    "Debug log: `evals/results/gate-debug.jsonl`.",
    "",
  );

  const outPath = path.join(outDir, "gate.md");
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log("\nWrote", outPath);

  await shutdownEmbedder();
  // Hard exit so ONNX workers cannot hang the process
  setTimeout(() => process.exit(0), 10_000).unref();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await shutdownEmbedder();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
