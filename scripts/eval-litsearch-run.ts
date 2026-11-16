/**
 * LitSearch recall eval via searchPapers.
 * Reports R@5, R@20, pool recall, cost, latency; logs which provider found gold.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeDoi } from "../src/lib/server/tools/papers/merge";
import { searchPapers } from "../src/lib/server/tools/papers/search";
import type {
  Paper,
  PaperProvider,
} from "../src/lib/server/tools/papers/types";

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
  let stage = "baseline";
  let concurrency = 1;
  let timeoutMs = 90_000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = Math.max(1, Number(args[++i]) || 50);
    }
    if (args[i] === "--stage" && args[i + 1]) {
      stage = String(args[++i]);
    }
    if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, Math.min(6, Number(args[++i]) || 1));
    }
    if (args[i] === "--timeout-ms" && args[i + 1]) {
      timeoutMs = Math.max(5_000, Number(args[++i]) || 90_000);
    }
  }
  return { limit, stage, concurrency, timeoutMs };
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
      `[litsearch] WARN: ${stillMissing.length} titles unresolved (S2 rate-limit).`,
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

function titleMatchesGold(paperTitle: string, goldTitles: string[]): boolean {
  const t = normTitle(paperTitle);
  const gold = goldTitles.map(normTitle).filter(Boolean);
  for (const g of gold) {
    if (t === g) return true;
    if (g.length > 12 && (t.includes(g) || g.includes(t))) return true;
  }
  return false;
}

function hitAtRank(papers: Paper[], goldTitles: string[], k: number): boolean {
  for (const p of papers.slice(0, k)) {
    if (titleMatchesGold(p.title, goldTitles)) return true;
    const doi = normalizeDoi(p.doi);
    if (doi && goldTitles.some((g) => normTitle(g) === doi)) return true;
  }
  return false;
}

/** Which providers' result lists contain a gold title. */
function providersFindingGold(
  providerPapers: Array<{ provider: PaperProvider; papers: Paper[] }>,
  goldTitles: string[],
): PaperProvider[] {
  const found: PaperProvider[] = [];
  for (const { provider, papers } of providerPapers) {
    if (papers.some((p) => titleMatchesGold(p.title, goldTitles))) {
      found.push(provider);
    }
  }
  return found;
}

async function main() {
  const { limit, stage, concurrency, timeoutMs } = parseArgs();
  const queries = await loadLitQueries(limit);
  const neededIds = new Set<number>();
  for (const q of queries) {
    for (const id of q.corpusids) neededIds.add(id);
  }
  const corpus = await loadCorpusIndex(neededIds);

  if (
    stage === "semantic" ||
    stage === "hop" ||
    stage === "llm" ||
    stage === "best" ||
    stage === "pool"
  ) {
    try {
      const { getEmbedder } = await import("../src/lib/server/memory/embedder");
      if (stage !== "pool") {
        const emb = await getEmbedder();
        await emb.embed(["warmup"], { isQuery: true });
        console.error("[litsearch] embedder ready");
      }
    } catch (e) {
      console.error("[litsearch] embedder warm failed:", e);
    }
  }

  let r5 = 0;
  let r20 = 0;
  let poolHits = 0;
  let n = 0;
  let timeouts = 0;
  let costSum = 0;
  let latSum = 0;
  let poolSizeSum = 0;
  let done = 0;
  const goldByProvider = new Map<string, number>();

  console.error(
    `[litsearch] stage=${stage} limit=${limit} concurrency=${concurrency} timeoutMs=${timeoutMs}`,
  );

  const work = queries.filter((q) => q.corpusids.some((id) => corpus.has(id)));

  async function runOne(q: (typeof work)[number]): Promise<void> {
    const goldTitles = q.corpusids
      .map((id) => corpus.get(id))
      .filter((t): t is string => Boolean(t));
    if (!goldTitles.length) return;

    const t0 = Date.now();
    try {
      const { papers, pool, providers, meta } = await searchPapers({
        query: q.query,
        limit: 20,
        stage,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latency = meta?.latencyMs ?? Date.now() - t0;
      const hit5 = hitAtRank(papers, goldTitles, 5);
      const hit20 = hitAtRank(papers, goldTitles, 20);
      const inPool = hitAtRank(pool, goldTitles, pool.length);
      const who = providersFindingGold(
        providers.map((p) => ({ provider: p.provider, papers: p.papers })),
        goldTitles,
      );
      costSum += meta?.costUsd ?? 0;
      latSum += latency;
      poolSizeSum += meta?.poolSize ?? pool.length;
      if (hit5) r5 += 1;
      if (hit20) r20 += 1;
      if (inPool) poolHits += 1;
      for (const p of who) {
        goldByProvider.set(p, (goldByProvider.get(p) ?? 0) + 1);
      }
      n += 1;
      done += 1;
      console.log(
        `[${done}/${work.length}] stage=${stage} R@5=${hit5 ? 1 : 0} R@20=${hit20 ? 1 : 0} pool=${inPool ? 1 : 0} providers=${who.join(",") || "-"} ${latency}ms poolSize=${meta?.poolSize ?? pool.length} titles=${goldTitles[0]?.slice(0, 48)}…`,
      );
    } catch (err) {
      const msg = String(err);
      const isTimeout =
        msg.includes("TimeoutError") ||
        msg.includes("aborted") ||
        msg.includes("AbortError") ||
        (err instanceof DOMException && err.name === "TimeoutError");
      done += 1;
      n += 1;
      latSum += Date.now() - t0;
      if (isTimeout) {
        timeouts += 1;
        console.error(
          `[${done}/${work.length}] stage=${stage} TIMEOUT ${timeoutMs}ms titles=${goldTitles[0]?.slice(0, 48)}…`,
        );
      } else {
        console.error(
          `[${done}/${work.length}] stage=${stage} ERROR ${msg.slice(0, 200)} titles=${goldTitles[0]?.slice(0, 48)}…`,
        );
      }
    }
  }

  process.on("uncaughtException", (err) => {
    console.error("[litsearch] uncaughtException", err);
  });
  process.on("unhandledRejection", (err) => {
    console.error("[litsearch] unhandledRejection", err);
  });

  let cursor = 0;
  async function worker() {
    while (cursor < work.length) {
      const i = cursor++;
      await runOne(work[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, work.length) }, () => worker()),
  );

  const recall5 = n ? r5 / n : 0;
  const recall20 = n ? r20 / n : 0;
  const poolRecall = n ? poolHits / n : 0;
  const avgCost = n ? costSum / n : 0;
  const avgLat = n ? latSum / n : 0;
  const avgPool = n ? poolSizeSum / n : 0;
  mkdirSync(outDir, { recursive: true });
  const row = `| ${stage} | ${n} | ${(poolRecall * 100).toFixed(1)}% | ${(recall5 * 100).toFixed(1)}% | ${(recall20 * 100).toFixed(1)}% | $${avgCost.toFixed(4)} | ${Math.round(avgLat)}ms | ${Math.round(avgPool)} | ${timeouts} |`;
  const mdPath = path.join(outDir, "litsearch.md");
  const providerLines = [...goldByProvider.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([p, c]) => `- ${p}: ${c}/${n} (${n ? ((c / n) * 100).toFixed(1) : 0}%)`,
    )
    .join("\n");

  const header = [
    "# LitSearch recall eval",
    "",
    "| Stage | N | Pool recall | Recall@5 | Recall@20 | Cost/query | Latency | Avg pool | Timeouts |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  let md = "";
  if (existsSync(mdPath)) {
    md = readFileSync(mdPath, "utf8");
  }
  // Migrate old header if needed
  if (!md.includes("| Timeouts |")) {
    // Keep prior rows but rewrite header; pad missing timeout cells.
    const priorRows = md
      .split("\n")
      .filter((l) => /^\| [a-z]/.test(l) && !l.includes("Stage"));
    const padded = priorRows.map((l) =>
      l.includes("| Timeouts |") || /\|\s*\d+\s*\|\s*$/.test(l)
        ? l
        : l.replace(/\|\s*$/, "| — |"),
    );
    md = [
      ...header,
      ...padded,
      row,
      "",
      "Ground truth: LitSearch query split; matching via normalised title overlap.",
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
      } else {
        out.push(line);
      }
    }
    if (!replaced) {
      const idx = out.findIndex((l) => l.startsWith("| ---"));
      if (idx >= 0) out.splice(idx + 1, 0, row);
      else out.push(row);
    }
    md = out.join("\n");
    if (!md.endsWith("\n")) md += "\n";
  }

  // Upsert provider attribution section for this stage
  const attrHeader = `### Gold-provider hits (\`${stage}\`)`;
  const attrBlock = `${attrHeader}\n\n${providerLines || "- (none)"}\n`;
  if (md.includes(attrHeader)) {
    md = md.replace(
      new RegExp(
        `### Gold-provider hits \\(\`${stage}\`\\)[\\s\\S]*?(?=\\n### |\\n# |$)`,
      ),
      attrBlock + "\n",
    );
  } else {
    md = md.trimEnd() + "\n\n" + attrBlock + "\n";
  }

  writeFileSync(mdPath, md);
  console.log("\n" + md);
  console.log("Wrote", mdPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
