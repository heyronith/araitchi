/**
 * Build LitSearch candidate pools ONCE (all providers + OpenAlex) and save to
 * evals/cache/litsearch-pools/. Ranking variants then run offline on these files.
 *
 * Usage: pnpm eval:litsearch:freeze --limit 100
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { searchPapers } from "../src/lib/server/tools/papers/search";
import type { Paper } from "../src/lib/server/tools/papers/types";
import {
  ensureCorpusTitles,
  goldTitlesForQuery,
  loadLitQueriesFromCache,
  litsearchCacheDir,
  zeroGoldTitleIndices,
} from "./litsearch-corpus";

const root = process.cwd();
const cacheDir = litsearchCacheDir(root);
const poolsDir = path.join(cacheDir, "litsearch-pools");

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 100;
  let timeoutMs = 120_000;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1])
      limit = Math.max(1, Number(args[++i]) || 100);
    if (args[i] === "--timeout-ms" && args[i + 1])
      timeoutMs = Math.max(10_000, Number(args[++i]) || 120_000);
    if (args[i] === "--start" && args[i + 1])
      start = Math.max(0, Number(args[++i]) || 0);
  }
  return { limit, timeoutMs, start };
}

export type FrozenPool = {
  index: number;
  query: string;
  goldTitles: string[];
  papers: Paper[];
  queries: string[];
  builtAt: string;
  meta?: {
    costUsd: number;
    openAlexCostUsd: number;
    poolSize: number;
    latencyMs: number;
    openAlexMode?: string;
  };
};

async function main() {
  const { limit, timeoutMs, start } = parseArgs();
  mkdirSync(poolsDir, { recursive: true });
  const queries = loadLitQueriesFromCache(limit, root);

  const neededIds = queries.flatMap((q) => q.corpusids);
  const corpus = await ensureCorpusTitles(neededIds, {
    root,
    limit,
    log: (msg) => console.error(msg),
  });

  const zeroGold = zeroGoldTitleIndices(queries, corpus);
  if (zeroGold.length) {
    console.error(
      `[freeze] FATAL: ${zeroGold.length} queries have zero gold titles after ensureCorpusTitles: ${zeroGold.join(",")}`,
    );
    process.exit(1);
  }

  console.error(
    `[freeze] n=${queries.length} start=${start} timeoutMs=${timeoutMs} → ${poolsDir}`,
  );

  let built = 0;
  let skippedExisting = 0;
  let skippedNoGold = 0;
  let errors = 0;
  const skippedNoGoldIds: number[] = [];
  const errorIds: number[] = [];

  for (let i = start; i < queries.length; i++) {
    const outPath = path.join(poolsDir, `${String(i).padStart(4, "0")}.json`);
    if (existsSync(outPath)) {
      skippedExisting += 1;
      console.error(`[freeze] skip existing ${path.basename(outPath)}`);
      continue;
    }
    const q = queries[i]!;
    const goldTitles = goldTitlesForQuery(q, corpus);
    if (!goldTitles.length) {
      // Should be unreachable after the preflight above; still count + record.
      skippedNoGold += 1;
      skippedNoGoldIds.push(i);
      console.error(`[freeze] ${i}: no gold titles — skip`);
      continue;
    }

    try {
      const { pool, meta } = await searchPapers({
        query: q.query,
        limit: 20,
        stage: "pool",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const frozen: FrozenPool = {
        index: i,
        query: q.query,
        goldTitles,
        papers: pool,
        queries: meta?.queries ?? [q.query],
        builtAt: new Date().toISOString(),
        meta: {
          costUsd: meta?.costUsd ?? 0,
          openAlexCostUsd: meta?.openAlexCostUsd ?? 0,
          poolSize: pool.length,
          latencyMs: meta?.latencyMs ?? 0,
          openAlexMode: meta?.openAlexMode,
        },
      };
      writeFileSync(outPath, JSON.stringify(frozen) + "\n");
      built += 1;
      console.log(
        `[freeze] ${i + 1}/${queries.length} pool=${pool.length} oaCost=$${(meta?.openAlexCostUsd ?? 0).toFixed(4)} mode=${meta?.openAlexMode ?? "?"} ${meta?.latencyMs ?? 0}ms`,
      );
    } catch (e) {
      errors += 1;
      errorIds.push(i);
      console.error(`[freeze] ${i} ERROR ${String(e).slice(0, 200)}`);
    }
  }

  const skipped = skippedExisting + skippedNoGold;
  console.error(
    `[freeze] done built=${built} skipped=${skipped} (existing=${skippedExisting} noGold=${skippedNoGold}) errors=${errors}`,
  );

  if (skippedNoGoldIds.length || errorIds.length) {
    if (skippedNoGoldIds.length) {
      console.error(
        `[freeze] skipped (no gold) query IDs: ${skippedNoGoldIds.join(",")}`,
      );
    }
    if (errorIds.length) {
      console.error(`[freeze] error query IDs: ${errorIds.join(",")}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
