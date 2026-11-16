/**
 * Measure end-to-end latency for searchPapers stage=best on frozen-query text.
 * Usage: pnpm exec tsx --import ./scripts/register-server-only.mjs scripts/bench-search-latency.ts [--limit 20]
 */
import { closeAppDb } from "../src/lib/server/db/client";
import {
  getEmbedder,
  shutdownEmbedder,
} from "../src/lib/server/memory/embedder";
import { searchPapers } from "../src/lib/server/tools/papers/search";
import { loadLitQueriesFromCache } from "./litsearch-corpus";

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function parseLimit(): number {
  const i = process.argv.indexOf("--limit");
  if (i >= 0 && process.argv[i + 1])
    return Math.max(1, Number(process.argv[i + 1]) || 20);
  return 20;
}

async function main() {
  const limit = parseLimit();
  const queries = loadLitQueriesFromCache(limit);
  console.error(`[latency] warming embedder…`);
  const emb = await getEmbedder();
  await emb.embed(["warmup query"], { isQuery: true });
  console.error(`[latency] embedder ready; n=${queries.length} stage=best`);

  const times: number[] = [];
  const poolSizes: number[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    const t0 = Date.now();
    const { papers, meta } = await searchPapers({
      query: q.query,
      limit: 20,
      stage: "best",
    });
    const ms = Date.now() - t0;
    times.push(ms);
    poolSizes.push(meta?.poolSize ?? papers.length);
    console.log(
      `[${i + 1}/${queries.length}] ${ms}ms papers=${papers.length} pool=${meta?.poolSize ?? "?"} stages=${(meta as { stagesApplied?: string[] })?.stagesApplied?.join("+") ?? "?"}`,
    );
  }

  const sorted = [...times].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(
    JSON.stringify(
      {
        n: times.length,
        avgMs: Math.round(avg),
        p50Ms: p50,
        p95Ms: p95,
        minMs: sorted[0],
        maxMs: sorted[sorted.length - 1],
        avgPool: Math.round(
          poolSizes.reduce((a, b) => a + b, 0) / poolSizes.length,
        ),
      },
      null,
      2,
    ),
  );

  await shutdownEmbedder().catch(() => undefined);
  closeAppDb();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await shutdownEmbedder().catch(() => undefined);
  closeAppDb();
  process.exit(1);
});
