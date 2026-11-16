/**
 * Shared LitSearch gold-title helpers for freeze / rank / eval scripts.
 *
 * Titles come from evals/cache/litsearch-corpus-index.json. Missing IDs are
 * filled from the LitSearch HF `corpus_clean` parquet (preferred) and then
 * Semantic Scholar as a fallback.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LitQueryRow = { query: string; corpusids: number[] };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function litsearchCacheDir(root = process.cwd()): string {
  return path.join(root, "evals/cache");
}

export function loadLitQueriesFromCache(
  limit: number,
  root = process.cwd(),
): LitQueryRow[] {
  const p = path.join(litsearchCacheDir(root), "litsearch-queries.json");
  if (!existsSync(p)) {
    throw new Error(
      `Missing ${p} — run eval:litsearch once to warm the query cache`,
    );
  }
  return (JSON.parse(readFileSync(p, "utf8")) as LitQueryRow[]).slice(0, limit);
}

function readCorpusFile(root: string): Map<number, string> {
  const map = new Map<number, string>();
  const cachePath = path.join(
    litsearchCacheDir(root),
    "litsearch-corpus-index.json",
  );
  if (!existsSync(cachePath)) return map;
  const obj = JSON.parse(readFileSync(cachePath, "utf8")) as Record<
    string,
    string
  >;
  for (const [k, v] of Object.entries(obj)) {
    if (v?.trim()) map.set(Number(k), v.trim());
  }
  return map;
}

function writeCorpusFile(root: string, map: Map<number, string>) {
  const cacheDir = litsearchCacheDir(root);
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, "litsearch-corpus-index.json");
  writeFileSync(
    cachePath,
    JSON.stringify(Object.fromEntries(map.entries()), null, 2) + "\n",
  );
}

/** Resolve titles via HF LitSearch parquet (scripts/build-litsearch-corpus-index.py). */
export function resolveCorpusTitlesFromHf(
  needed: number[],
  opts?: { root?: string; limit?: number; log?: (msg: string) => void },
): Map<number, string> {
  const root = opts?.root ?? process.cwd();
  const script = path.join(root, "scripts/build-litsearch-corpus-index.py");
  if (!existsSync(script)) {
    opts?.log?.(`[litsearch] missing ${script}`);
    return readCorpusFile(root);
  }
  const args = [script, "--root", root, "--limit", String(opts?.limit ?? 100)];
  if (needed.length) {
    args.push("--ids", ...needed.map(String));
  }
  const r = spawnSync("python3", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.stdout?.trim()) opts?.log?.(r.stdout.trim());
  if (r.stderr?.trim()) opts?.log?.(r.stderr.trim());
  if (r.status !== 0 && r.status !== null) {
    opts?.log?.(
      `[litsearch] HF corpus build exited ${r.status}: ${r.stderr?.slice(0, 200) ?? ""}`,
    );
  }
  return readCorpusFile(root);
}

/** Resolve Semantic Scholar CorpusIds → titles (with retries / polite pacing). */
export async function resolveCorpusTitles(
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
        if (res.status === 403) {
          // Invalid key — abort S2 path quickly.
          return map;
        }
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

/**
 * Load corpus title index from disk and resolve any missing IDs.
 * Prefer HF LitSearch parquet; fall back to Semantic Scholar.
 */
export async function ensureCorpusTitles(
  needed: Iterable<number>,
  opts?: { root?: string; limit?: number; log?: (msg: string) => void },
): Promise<Map<number, string>> {
  const root = opts?.root ?? process.cwd();
  mkdirSync(litsearchCacheDir(root), { recursive: true });
  let map = readCorpusFile(root);

  const missing = [...new Set(needed)].filter((id) => !map.has(id));
  if (!missing.length) return map;

  opts?.log?.(
    `[litsearch] ${missing.length} corpus titles missing — trying HF LitSearch parquet…`,
  );
  map = resolveCorpusTitlesFromHf(missing, {
    root,
    limit: opts?.limit,
    log: opts?.log,
  });

  const still = missing.filter((id) => !map.has(id));
  if (!still.length) return map;

  opts?.log?.(
    `[litsearch] resolving ${still.length} remaining titles via Semantic Scholar…`,
  );
  const resolved = await resolveCorpusTitles(still);
  for (const [id, title] of resolved) map.set(id, title);
  writeCorpusFile(root, map);

  const unresolved = still.filter((id) => !map.has(id));
  if (unresolved.length) {
    opts?.log?.(
      `[litsearch] WARN: ${unresolved.length} titles unresolved after HF+S2.`,
    );
  }
  return map;
}

/** Gold titles for one query from a corpus map. */
export function goldTitlesForQuery(
  q: LitQueryRow,
  corpus: Map<number, string>,
): string[] {
  return q.corpusids
    .map((id) => corpus.get(id))
    .filter((t): t is string => Boolean(t));
}

/**
 * Assert every query in the list has ≥1 gold title after corpus load.
 * Returns zero-title query indices (empty when healthy).
 */
export function zeroGoldTitleIndices(
  queries: LitQueryRow[],
  corpus: Map<number, string>,
): number[] {
  const bad: number[] = [];
  for (let i = 0; i < queries.length; i++) {
    if (!goldTitlesForQuery(queries[i]!, corpus).length) bad.push(i);
  }
  return bad;
}
