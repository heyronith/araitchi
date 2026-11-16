/**
 * Offline ranking compare on frozen LitSearch pools.
 * Variants: rrf | qwen | llm  (identical candidate pools).
 *
 * Usage: pnpm eval:litsearch:rank --variant rrf|qwen|llm --limit 100
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { closeAppDb } from "../src/lib/server/db/client";
import { shutdownEmbedder } from "../src/lib/server/memory/embedder";
import {
  llmRerankPapers,
  semanticRerankPapers,
} from "../src/lib/server/tools/papers/enhance";
import { requireOpenRouterApiKey } from "../src/lib/server/openrouter";
import type { Paper } from "../src/lib/server/tools/papers/types";
import type { FrozenPool } from "./eval-litsearch-freeze-pools";

const root = process.cwd();
const defaultPoolsDir = path.join(root, "evals/cache/litsearch-pools");
const outDir = path.join(root, "evals/results");

const PER_QUERY_TIMEOUT_MS = 60_000;
const EXIT_HARD_MS = 10_000;

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 100;
  let variant: "rrf" | "qwen" | "llm" = "rrf";
  let poolsDir = defaultPoolsDir;
  let maxSpendUsd = 2;
  let queryTimeoutMs = PER_QUERY_TIMEOUT_MS;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1])
      limit = Math.max(1, Number(args[++i]) || 100);
    if (args[i] === "--variant" && args[i + 1]) {
      const v = String(args[++i]);
      if (v === "rrf" || v === "qwen" || v === "llm") variant = v;
    }
    if (args[i] === "--pools-dir" && args[i + 1]) poolsDir = String(args[++i]);
    if (args[i] === "--max-spend" && args[i + 1])
      maxSpendUsd = Math.max(0, Number(args[++i]) || 0);
    if (args[i] === "--query-timeout-ms" && args[i + 1])
      queryTimeoutMs = Math.max(
        1_000,
        Number(args[++i]) || PER_QUERY_TIMEOUT_MS,
      );
  }
  return { limit, variant, poolsDir, maxSpendUsd, queryTimeoutMs };
}

function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hitAtRank(papers: Paper[], goldTitles: string[], k: number): boolean {
  const gold = goldTitles.map(normTitle).filter(Boolean);
  for (const p of papers.slice(0, k)) {
    const t = normTitle(p.title);
    for (const g of gold) {
      if (t === g) return true;
      if (g.length > 12 && (t.includes(g) || g.includes(t))) return true;
    }
  }
  return false;
}

function loadPools(poolsDir: string, limit: number): FrozenPool[] {
  if (!existsSync(poolsDir)) {
    throw new Error(
      `No frozen pools at ${poolsDir}. Run: pnpm eval:litsearch:freeze --limit ${limit}`,
    );
  }
  const files = readdirSync(poolsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(0, limit);
  return files.map(
    (f) =>
      JSON.parse(readFileSync(path.join(poolsDir, f), "utf8")) as FrozenPool,
  );
}

function upsertRow(stage: string, row: string) {
  mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, "litsearch.md");
  let md = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
  if (!md.includes("| Timeouts |")) {
    md = [
      "# LitSearch recall eval",
      "",
      "| Stage | N | Pool recall | Recall@5 | Recall@20 | Cost/query | Latency | Avg pool | Timeouts |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      row,
      "",
    ].join("\n");
  } else {
    const lines = md.split("\n");
    const out: string[] = [];
    let replaced = false;
    for (const line of lines) {
      if (line.startsWith(`| ${stage} |`)) {
        out.push(row);
        replaced = true;
      } else out.push(line);
    }
    if (!replaced) {
      const idx = out.findIndex((l) => l.startsWith("| ---"));
      if (idx >= 0) out.splice(idx + 1, 0, row);
      else out.push(row);
    }
    md = out.join("\n");
  }
  if (!md.endsWith("\n")) md += "\n";
  writeFileSync(mdPath, md);
  return mdPath;
}

async function teardown() {
  try {
    await shutdownEmbedder();
  } catch (e) {
    console.error("[rank] shutdownEmbedder:", e);
  }
  try {
    closeAppDb();
  } catch (e) {
    console.error("[rank] closeAppDb:", e);
  }
}

async function main() {
  const { limit, variant, poolsDir, maxSpendUsd, queryTimeoutMs } = parseArgs();
  const pools = loadPools(poolsDir, limit);
  const nLabel = `${pools.length}/${limit}`;
  const incomplete = pools.length < limit;
  console.error(
    `[rank] variant=${variant} N=${nLabel}${incomplete ? " (INCOMPLETE — not a full result)" : ""}`,
  );
  if (incomplete) {
    console.error(
      `[rank] refusing full-result claim: only ${pools.length} frozen pools for --limit ${limit}`,
    );
  }

  const wholeRunMs = Math.max(
    120_000,
    limit * (queryTimeoutMs + 30_000) + 60_000,
  );
  const watchdog = setTimeout(() => {
    console.error(
      `[rank] WHOLE-RUN WATCHDOG fired after ${wholeRunMs}ms — forcing exit`,
    );
    process.exit(2);
  }, wholeRunMs);
  watchdog.unref?.();

  let exitCode = incomplete ? 1 : 0;
  let apiKey: string | null = null;

  try {
    if (variant === "llm" || variant === "qwen") {
      try {
        const { getEmbedder } =
          await import("../src/lib/server/memory/embedder");
        const emb = await getEmbedder();
        await emb.embed(["warmup"], { isQuery: true });
        console.error("[rank] embedder ready");
      } catch (e) {
        console.error("[rank] embedder warm failed", e);
      }
    }
    if (variant === "llm") {
      try {
        apiKey = await requireOpenRouterApiKey();
      } catch {
        console.error("[rank] OpenRouter key required for llm variant");
        exitCode = 1;
        return;
      }
    }

    let r5 = 0;
    let r20 = 0;
    let poolHits = 0;
    let n = 0;
    let costSum = 0;
    let latSum = 0;
    let poolSizeSum = 0;
    let timeouts = 0;
    let spendCapHit = false;

    for (const frozen of pools) {
      if (variant === "llm" && costSum >= maxSpendUsd) {
        spendCapHit = true;
        console.error(
          `[rank] LLM spend cap $${maxSpendUsd.toFixed(2)} reached — stopping early at N=${n}`,
        );
        break;
      }

      const t0 = Date.now();
      let ranked = frozen.papers;
      let cost = 0;
      let timedOut = false;
      // Abort between embed batches — do NOT terminate the ONNX worker mid-batch
      // (Napi abort) and do NOT Promise.race-abandon work (embed-lock cascade).
      const ac = new AbortController();
      const timeoutTimer = setTimeout(() => ac.abort(), queryTimeoutMs);

      try {
        if (variant === "qwen" || variant === "llm") {
          ranked = await semanticRerankPapers({
            query: frozen.query,
            papers: ranked,
            signal: ac.signal,
          });
        }
        if (variant === "llm") {
          const r = await llmRerankPapers({
            query: frozen.query,
            papers: ranked,
            apiKey,
            signal: ac.signal,
          });
          ranked = r.papers;
          cost = r.costUsd;
        }
      } catch (e) {
        timedOut = true;
        ranked = frozen.papers;
        console.error(
          `[rank] timeout/error on ${frozen.index}: ${String(e).slice(0, 160)}`,
        );
      } finally {
        clearTimeout(timeoutTimer);
      }

      // semanticRerank swallows AbortError and returns RRF order; detect here.
      if (ac.signal.aborted) {
        timedOut = true;
        ranked = frozen.papers;
        console.error(
          `[rank] query ${frozen.index} timed out (>${queryTimeoutMs}ms)`,
        );
      }
      if (timedOut) timeouts += 1;

      const latency = Date.now() - t0;
      const hit5 = hitAtRank(ranked, frozen.goldTitles, 5);
      const hit20 = hitAtRank(ranked, frozen.goldTitles, 20);
      const inPool = hitAtRank(
        frozen.papers,
        frozen.goldTitles,
        frozen.papers.length,
      );
      if (hit5) r5 += 1;
      if (hit20) r20 += 1;
      if (inPool) poolHits += 1;
      n += 1;
      costSum += cost;
      latSum += latency;
      poolSizeSum += frozen.papers.length;
      console.log(
        `[${n}/${pools.length}] ${variant} R@5=${hit5 ? 1 : 0} R@20=${hit20 ? 1 : 0} pool=${inPool ? 1 : 0} ${latency}ms poolSize=${frozen.papers.length}${timedOut ? " TIMEOUT" : ""}`,
      );
    }

    const stage = `frozen-${variant}`;
    const nCell = incomplete || spendCapHit ? `${n}/${limit}` : String(n);
    const row = `| ${stage} | ${nCell} | ${((n ? poolHits / n : 0) * 100).toFixed(1)}% | ${((n ? r5 / n : 0) * 100).toFixed(1)}% | ${((n ? r20 / n : 0) * 100).toFixed(1)}% | $${(n ? costSum / n : 0).toFixed(4)} | ${Math.round(n ? latSum / n : 0)}ms | ${Math.round(n ? poolSizeSum / n : 0)} | ${timeouts} |`;
    const mdPath = upsertRow(stage, row);
    console.log("\n" + readFileSync(mdPath, "utf8"));
    console.log("Wrote", mdPath);
    if (incomplete || spendCapHit) {
      console.error(
        `[rank] partial result N=${nCell} — do not treat as full ${limit}-query eval`,
      );
      exitCode = 1;
    }
  } catch (e) {
    console.error(e);
    exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    const hard = setTimeout(() => {
      console.error(
        `[rank] hard exit after ${EXIT_HARD_MS}ms post-results teardown`,
      );
      process.exit(exitCode);
    }, EXIT_HARD_MS);
    hard.unref?.();
    await teardown();
    process.exit(exitCode);
  }
}

main().catch((e) => {
  console.error(e);
  void teardown().finally(() => process.exit(1));
});
