/**
 * LitSearch recall@k via searchPapers. Cached HF downloads in evals/cache/ (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeDoi } from "../src/lib/server/tools/papers/merge";
import { searchPapers } from "../src/lib/server/tools/papers/search";

const root = process.cwd();
const cacheDir = path.join(root, "evals/cache");
const outDir = path.join(root, "evals/results");

type LitQueryRow = {
  query: string;
  corpusids: number[];
};

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 50;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = Math.max(1, Number(args[++i]) || 50);
    }
  }
  return { limit };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function hfRows<T>(
  config: string,
  offset: number,
  length: number,
): Promise<{ rows: Array<{ row: T }>; num_rows_total: number }> {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", "princeton-nlp/LitSearch");
  url.searchParams.set("config", config);
  url.searchParams.set("split", "full");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(length));
  let lastErr = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      return (await res.json()) as {
        rows: Array<{ row: T }>;
        num_rows_total: number;
      };
    }
    lastErr = `HF rows ${config}: HTTP ${res.status}`;
    const retryAfter = Number(res.headers.get("retry-after") || 0);
    const wait = Math.max(retryAfter * 1000, 1500 * 2 ** attempt);
    if (res.status === 429 || res.status >= 500) {
      await sleep(wait);
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || `HF rows ${config}: retries exhausted`);
}

/** LitSearch corpusids are Semantic Scholar CorpusIds — resolve titles via S2. */
async function resolveCorpusTitles(
  ids: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "araitchi-litsearch-eval/0.1",
  };
  if (key) headers["x-api-key"] = key;

  for (const id of ids) {
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      try {
        const res = await fetch(
          `https://api.semanticscholar.org/graph/v1/paper/CorpusId:${id}?fields=title`,
          { headers },
        );
        if (res.status === 429) {
          const ra = Number(res.headers.get("retry-after") || 0);
          await sleep(Math.max(ra * 1000, 2000 * 2 ** attempt));
          continue;
        }
        if (!res.ok) {
          await sleep(500 * 2 ** attempt);
          break;
        }
        const json = (await res.json()) as { title?: string };
        if (json.title) map.set(id, json.title.trim());
        ok = true;
      } catch {
        await sleep(500 * 2 ** attempt);
      }
    }
    // S2 anonymous: stay ≤ ~1 req/s
    await sleep(key ? 200 : 1100);
  }
  return map;
}

async function loadLitQueries(limit: number): Promise<LitQueryRow[]> {
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, "litsearch-queries.json");
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8")) as LitQueryRow[];
    return cached.slice(0, limit);
  }

  const all: LitQueryRow[] = [];
  let offset = 0;
  const page = 100;
  let total = Infinity;
  while (offset < total) {
    const batch = await hfRows<{
      query: string;
      corpusids: number[];
    }>("query", offset, page);
    total = batch.num_rows_total;
    for (const { row } of batch.rows) {
      all.push({ query: row.query, corpusids: row.corpusids ?? [] });
    }
    offset += batch.rows.length;
    if (!batch.rows.length) break;
  }
  writeFileSync(cachePath, JSON.stringify(all, null, 2) + "\n");
  return all.slice(0, limit);
}

async function loadCorpusIndex(
  needed: Set<number>,
): Promise<Map<number, string>> {
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, "litsearch-corpus-index.json");
  const map = new Map<number, string>();
  if (existsSync(cachePath)) {
    const obj = JSON.parse(readFileSync(cachePath, "utf8")) as Record<
      string,
      string
    >;
    for (const [k, v] of Object.entries(obj)) map.set(Number(k), v);
  }

  const missing = [...needed].filter((id) => !map.has(id));
  if (!missing.length) return map;

  console.error(
    `[litsearch] resolving ${missing.length} corpus titles via Semantic Scholar…`,
  );
  const resolved = await resolveCorpusTitles(missing);
  for (const [id, title] of resolved) map.set(id, title);

  const stillMissing = missing.filter((id) => !map.has(id));
  if (stillMissing.length) {
    console.error(
      `[litsearch] WARN: ${stillMissing.length} titles unresolved (S2 rate-limit). ` +
        `Pre-warm with: python -c "from datasets import load_dataset; …" into ${cachePath}`,
    );
  }

  writeFileSync(
    cachePath,
    JSON.stringify(Object.fromEntries(map.entries()), null, 2) + "\n",
  );
  return map;
}

function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hitAtRank(
  papers: Awaited<ReturnType<typeof searchPapers>>["papers"],
  goldTitles: string[],
  k: number,
): boolean {
  const gold = new Set(goldTitles.map(normTitle).filter(Boolean));
  const top = papers.slice(0, k);
  for (const p of top) {
    const t = normTitle(p.title);
    if (gold.has(t)) return true;
    for (const g of gold) {
      if (g.length > 12 && (t.includes(g) || g.includes(t))) return true;
    }
    const doi = normalizeDoi(p.doi);
    if (doi && gold.has(doi)) return true;
  }
  return false;
}

async function main() {
  const { limit } = parseArgs();
  const queries = await loadLitQueries(limit);
  const neededIds = new Set<number>();
  for (const q of queries) {
    for (const id of q.corpusids) neededIds.add(id);
  }
  const corpus = await loadCorpusIndex(neededIds);

  let r5 = 0;
  let r20 = 0;
  let n = 0;

  for (const q of queries) {
    const goldTitles = q.corpusids
      .map((id) => corpus.get(id))
      .filter((t): t is string => Boolean(t));
    if (!goldTitles.length) continue;

    const { papers } = await searchPapers({ query: q.query, limit: 20 });
    if (hitAtRank(papers, goldTitles, 5)) r5 += 1;
    if (hitAtRank(papers, goldTitles, 20)) r20 += 1;
    n += 1;
    console.log(
      `[${n}/${queries.length}] recall@5=${hitAtRank(papers, goldTitles, 5) ? 1 : 0} titles=${goldTitles[0]?.slice(0, 48)}…`,
    );
  }

  const recall5 = n ? r5 / n : 0;
  const recall20 = n ? r20 / n : 0;
  mkdirSync(outDir, { recursive: true });
  const md = [
    "# LitSearch recall eval",
    "",
    `Queries evaluated: ${n} (limit ${limit})`,
    "",
    `Recall@5: **${(recall5 * 100).toFixed(1)}%**`,
    `Recall@20: **${(recall20 * 100).toFixed(1)}%**`,
    "",
    "Ground truth: LitSearch query split (`corpusids` → titles via Semantic Scholar CorpusId lookup; HF query split cached under `evals/cache/`).",
    "Matching: normalised title overlap on merged `searchPapers` results.",
    "",
  ].join("\n");
  writeFileSync(path.join(outDir, "litsearch.md"), md);
  console.log("\n" + md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
