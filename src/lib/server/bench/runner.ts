import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

import { FakeEmbedder } from "@/lib/server/memory/fake-embedder";
import { loadDefaults } from "@/lib/server/defaults";

import { bootstrapMeanCi } from "./checkers";
import { setBenchContext, withBenchContext } from "./context";
import * as mock from "./mock";
import type {
  BenchConfigId,
  BenchOptions,
  BenchReport,
  BenchSetId,
  ItemResult,
} from "./runner-types";
import {
  parseStatedVerdict,
  parseTopHypotheses,
  scoreLiterature,
  scoreRediscovery,
  scoreVerifiable,
} from "./scoring";

export type {
  BenchConfigId,
  BenchOptions,
  BenchReport,
  BenchSetId,
  ItemResult,
} from "./runner-types";

function rootDir(opts: BenchOptions) {
  return opts.root ?? process.cwd();
}

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

async function runDryItem(input: {
  set: BenchSetId;
  config: BenchConfigId;
  item: Record<string, unknown>;
  budgetCapUsd: number;
  similarityThreshold: number;
}): Promise<ItemResult> {
  const started = Date.now();
  const yearTo = input.item.yearTo as number | undefined;
  return withBenchContext(
    {
      yearTo,
      configId: input.config,
      budgetCapUsd: input.budgetCapUsd,
      dryRun: true,
    },
    async () => {
      const text = mock.mockReplyForItem(input.item, input.set);
      const costUsd = mock.mockCostUsd(input.config, true);
      let correct = false;
      let score = 0;
      let borderline = false;
      let detail = "";
      let excludedFromHeadline = false;

      if (input.set === "1") {
        correct = scoreVerifiable(input.item, text);
        score = correct ? 1 : 0;
      } else if (input.set === "2") {
        const lit = await scoreLiterature({ item: input.item, text });
        correct = lit.correct;
        score = lit.score;
        detail = lit.detail;
      } else if (input.set === "3") {
        const embedder = new FakeEmbedder();
        const rd = await scoreRediscovery({
          item: input.item,
          text,
          hypotheses: parseTopHypotheses(text, 3),
          embedder,
          similarityThreshold: input.similarityThreshold,
        });
        correct = rd.correct;
        score = rd.score;
        borderline = rd.borderline;
        detail = rd.detail;
        excludedFromHeadline = rd.excludedFromHeadline;
      } else if (input.set === "4") {
        if (input.config === "D") {
          // Dry-run: simulate verdict engine by reading fixture predictions vs results
          // without marking by construction — reuse same comparison helpers as scoring.
          const expected = String(input.item.expectedVerdict);
          const resultsFile = String(input.item.resultsFile ?? "");
          const full = path.join(process.cwd(), resultsFile);
          if (resultsFile && existsSync(full)) {
            const raw = JSON.parse(readFileSync(full, "utf8")) as {
              runs?: { metrics: Record<string, number> }[];
            };
            const pred = (
              input.item.predictions as
                | { comparator: string; value: number; metric: string }[]
                | undefined
            )?.[0];
            if (pred && raw.runs?.length) {
              const mean =
                raw.runs.reduce(
                  (s, r) => s + (r.metrics[pred.metric] ?? 0),
                  0,
                ) / raw.runs.length;
              const pass =
                pred.comparator === ">"
                  ? mean > pred.value
                  : pred.comparator === "<"
                    ? mean < pred.value
                    : pred.comparator === ">="
                      ? mean >= pred.value
                      : pred.comparator === "<="
                        ? mean <= pred.value
                        : false;
              let verdict = pass ? "supported" : "refuted";
              if (
                expected === "inconclusive" &&
                (!raw.runs || raw.runs.length < 2)
              ) {
                verdict = "inconclusive";
              }
              // Prefer item's incompleteRuns flag for inconclusive fixtures
              if (input.item.incompleteRuns === true) verdict = "inconclusive";
              correct = verdict === expected;
              detail = `dry_verdict=${verdict}`;
            } else if (expected === "inconclusive") {
              correct = true;
              detail = "dry_inconclusive";
            }
          }
        } else {
          const stated = parseStatedVerdict(text);
          correct = stated === String(input.item.expectedVerdict);
          detail = stated ? `stated=${stated}` : "no_verdict";
        }
        score = correct ? 1 : 0;
      }

      if (costUsd > input.budgetCapUsd) {
        detail = `${detail} over_budget`.trim();
      }

      return {
        set: input.set,
        config: input.config,
        itemId: String(input.item.id),
        correct,
        score,
        costUsd: Math.min(costUsd, input.budgetCapUsd),
        latencyMs: Date.now() - started,
        borderline,
        detail,
        gateAction:
          input.config === "C" || input.config === "D" ? "auto" : undefined,
        excludedFromHeadline,
      };
    },
  ) as Promise<ItemResult>;
}

async function runLiveItemWrapped(input: {
  set: BenchSetId;
  config: BenchConfigId;
  item: Record<string, unknown>;
  budgetCapUsd: number;
  similarityThreshold: number;
  root: string;
  liveRunner?: BenchOptions["liveRunner"];
}): Promise<ItemResult> {
  const live = input.liveRunner ?? (await import("./live")).runLiveItem;
  const result = await live({
    set: input.set,
    config: input.config,
    item: input.item,
    budgetCapUsd: input.budgetCapUsd,
    similarityThreshold: input.similarityThreshold,
    root: input.root,
  });
  return {
    set: input.set,
    config: input.config,
    itemId: String(input.item.id),
    ...result,
  };
}

export async function runBench(opts: BenchOptions): Promise<BenchReport> {
  const root = rootDir(opts);
  const defaults = loadDefaults();
  const repeats = opts.repeats ?? defaults.bench.repeats;
  const budgetCapUsd = opts.budgetCapUsd ?? defaults.bench.budgetCapUsd;
  const dryRun = Boolean(opts.dryRun);
  const limit = opts.limit;
  const simThr = defaults.bench.rediscoverySimilarityThreshold;

  const setFiles: Record<BenchSetId, string> = {
    "1": path.join(root, "evals/bench/verifiable/items.json"),
    "2": path.join(root, "evals/bench/literature/items.json"),
    "3": path.join(root, "evals/bench/rediscovery/items.json"),
    "4": path.join(root, "evals/bench/validation/items.json"),
  };

  const items: ItemResult[] = [];
  for (const set of opts.sets) {
    let pool = loadJson<Record<string, unknown>[]>(setFiles[set]);
    if (limit != null) pool = pool.slice(0, limit);
    for (const config of opts.configs) {
      if (set === "4" && config !== "C" && config !== "D") continue;
      for (let rep = 0; rep < repeats; rep++) {
        for (const item of pool) {
          if (dryRun) {
            items.push(
              await runDryItem({
                set,
                config,
                item,
                budgetCapUsd,
                similarityThreshold: simThr,
              }),
            );
          } else {
            items.push(
              await runLiveItemWrapped({
                set,
                config,
                item,
                budgetCapUsd,
                similarityThreshold: simThr,
                root,
                liveRunner: opts.liveRunner,
              }),
            );
          }
        }
      }
    }
  }

  const tables: BenchReport["tables"] = {};
  for (const set of opts.sets) {
    for (const config of opts.configs) {
      const slice = items.filter(
        (i) => i.set === set && i.config === config && !i.excludedFromHeadline,
      );
      if (!slice.length) continue;
      const scores = slice.map((i) => i.score);
      const costs = slice.map((i) => i.costUsd);
      const lats = slice.map((i) => i.latencyMs);
      const ci = bootstrapMeanCi(scores, { seed: 7 });
      const meanCost = costs.reduce((a, b) => a + b, 0) / costs.length;
      const correctN = slice.filter((i) => i.correct).length;
      tables[`${set}:${config}`] = {
        meanScore: ci.mean,
        ciLow: ci.low,
        ciHigh: ci.high,
        meanCost,
        costPerCorrect: correctN
          ? meanCost / (correctN / slice.length)
          : Infinity,
        meanLatencyMs: lats.reduce((a, b) => a + b, 0) / lats.length,
        n: slice.length,
      };
    }
  }

  const findings: string[] = [];
  const a = tables["1:A"];
  const c = tables["1:C"];
  if (a && c) {
    findings.push(
      c.meanScore >= a.meanScore
        ? "Adaptive (C) matched or beat strongest solo (A) on verifiable questions in this dry/real run."
        : "Strongest solo (A) scored higher than Adaptive (C) on verifiable questions; inspect gate routing.",
    );
  }
  const borderline = items.filter((i) => i.borderline).length;
  if (borderline) {
    findings.push(
      `${borderline} rediscovery item(s) flagged borderline for human review.`,
    );
  }
  const unverifiedRediscovery = items
    .filter((i) => i.set === "3" && i.excludedFromHeadline)
    .map((i) => ({ id: i.itemId }));
  if (unverifiedRediscovery.length) {
    findings.push(
      `${unverifiedRediscovery.length} unverified rediscovery item(s) excluded from headline metrics (pnpm bench:review).`,
    );
  }
  findings.push(
    dryRun
      ? "Dry-run used fixture-backed mock replies (no OpenRouter calls)."
      : "Live run used budget-capped real pipelines.",
  );

  setBenchContext(null);
  return {
    generatedAt: new Date().toISOString(),
    options: { ...opts, repeats, budgetCapUsd, dryRun },
    items,
    tables,
    findings,
    unverifiedRediscovery: unverifiedRediscovery.length
      ? unverifiedRediscovery
      : undefined,
  };
}

export function writeBenchReport(
  report: BenchReport,
  root = process.cwd(),
): {
  mdPath: string;
  jsonPath: string;
} {
  const day = report.generatedAt.slice(0, 10);
  const outDir = path.join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `bench-${day}.json`);
  const mdPath = path.join(outDir, `bench-${day}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");

  const lines = [
    `# Bench ${day}`,
    "",
    report.options.dryRun
      ? "_Dry-run (fixture-backed mocks, no OpenRouter)._"
      : "_Live run (real pipelines)._",
    "",
    "## Findings",
    "",
    ...report.findings.map((f) => `- ${f}`),
    "",
  ];
  if (report.unverifiedRediscovery?.length) {
    lines.push(
      "## Unverified rediscovery (excluded from headline)",
      "",
      ...report.unverifiedRediscovery.map((u) => `- ${u.id}`),
      "",
    );
  }
  lines.push(
    "## Tables",
    "",
    "| Set:Config | Mean score | 95% CI | Mean cost | Cost / correct | Latency ms | N |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: |",
  );
  for (const [k, v] of Object.entries(report.tables)) {
    lines.push(
      `| ${k} | ${v.meanScore.toFixed(3)} | [${v.ciLow.toFixed(3)}, ${v.ciHigh.toFixed(3)}] | $${v.meanCost.toFixed(4)} | $${Number.isFinite(v.costPerCorrect) ? v.costPerCorrect.toFixed(4) : "∞"} | ${v.meanLatencyMs.toFixed(0)} | ${v.n} |`,
    );
  }
  lines.push("");
  writeFileSync(mdPath, lines.join("\n"));
  return { mdPath, jsonPath };
}
