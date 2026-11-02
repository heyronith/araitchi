/**
 * Offline fixture validation (schema, duplicates, sources).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  normalizeArxivId,
  normalizeDoi,
} from "@/lib/server/tools/papers/merge";

export type FetchLike = typeof fetch;

export type ResolveOptions = {
  fetch?: FetchLike;
  mailto?: string;
  signal?: AbortSignal;
};

const BENCH_ITEM_FILES = [
  "evals/bench/verifiable/items.json",
  "evals/bench/literature/items.json",
  "evals/bench/rediscovery/items.json",
  "evals/bench/validation/items.json",
] as const;

export function arxivIdFromDoi(doi: string | null | undefined): string | null {
  const normalized = normalizeDoi(doi);
  if (!normalized) return null;
  const m = /^10\.48550\/arxiv\.(.+)$/.exec(normalized);
  return m ? normalizeArxivId(m[1]) : null;
}

export function crossrefWorksUrl(doi: string, mailto?: string): string {
  const base = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  if (!mailto) return base;
  return `${base}?mailto=${encodeURIComponent(mailto)}`;
}

/** True when Crossref `/works/{doi}` returns HTTP 200. */
export async function resolveViaCrossref(
  doi: string,
  options: ResolveOptions = {},
): Promise<boolean> {
  const normalized = normalizeDoi(doi);
  if (!normalized) return false;
  const fetchImpl = options.fetch ?? fetch;
  const res = await fetchImpl(crossrefWorksUrl(normalized, options.mailto), {
    signal: options.signal,
    headers: { Accept: "application/json" },
  });
  return res.ok;
}

/** True when doi.org handle API reports `responseCode` 1. */
export async function resolveViaDoiHandle(
  doi: string,
  options: ResolveOptions = {},
): Promise<boolean> {
  const normalized = normalizeDoi(doi);
  if (!normalized) return false;
  const fetchImpl = options.fetch ?? fetch;
  const res = await fetchImpl(
    `https://doi.org/api/handles/${encodeURIComponent(normalized)}`,
    { signal: options.signal, headers: { Accept: "application/json" } },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { responseCode?: number };
  return data.responseCode === 1;
}

/** True when export.arxiv.org returns at least one entry for the id. */
export async function resolveViaArxiv(
  arxivId: string,
  options: ResolveOptions = {},
): Promise<boolean> {
  const id = normalizeArxivId(arxivId);
  if (!id) return false;
  const fetchImpl = options.fetch ?? fetch;
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`;
  const res = await fetchImpl(url, { signal: options.signal });
  if (!res.ok) return false;
  const text = await res.text();
  return (
    /<entry[\s>]/i.test(text) ||
    /<opensearch:totalResults>([1-9]\d*)<\/opensearch:totalResults>/i.test(text)
  );
}

/** Crossref → doi.org handles → arXiv (for DataCite arXiv DOIs). */
export async function resolveBenchDoi(
  doi: string,
  options: ResolveOptions = {},
): Promise<boolean> {
  if (await resolveViaCrossref(doi, options)) return true;
  if (await resolveViaDoiHandle(doi, options)) return true;
  const arxiv = arxivIdFromDoi(doi);
  if (arxiv) return resolveViaArxiv(arxiv, options);
  return false;
}

export type BenchSourceRef = {
  doi?: string;
  arxivId?: string;
  openalexId?: string;
  url?: string;
};

export async function resolveBenchSourceRef(
  source: BenchSourceRef,
  options: ResolveOptions = {},
): Promise<boolean> {
  const doi = normalizeDoi(source.doi);
  if (doi && (await resolveBenchDoi(doi, options))) return true;
  const arxiv =
    normalizeArxivId(source.arxivId) ?? arxivIdFromDoi(source.doi ?? null);
  if (arxiv && (await resolveViaArxiv(arxiv, options))) return true;
  return false;
}

export function collectBenchFixtureDois(root = process.cwd()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rel of BENCH_ITEM_FILES) {
    for (const item of loadArr(path.join(root, rel))) {
      const src = item.source as BenchSourceRef | undefined;
      if (src?.doi) {
        const d = normalizeDoi(src.doi);
        if (d && !seen.has(d)) {
          seen.add(d);
          out.push(d);
        }
      }
      const gold = item.goldDois as unknown;
      if (Array.isArray(gold)) {
        for (const raw of gold) {
          const d = normalizeDoi(String(raw));
          if (d && d.startsWith("10.") && !seen.has(d)) {
            seen.add(d);
            out.push(d);
          }
        }
      }
    }
  }
  return out;
}

export type OnlineFixtureValidation = {
  ok: boolean;
  total: number;
  resolved: number;
  pct: number;
  failures: string[];
};

export async function validateBenchFixturesOnline(
  root = process.cwd(),
  options: ResolveOptions = {},
): Promise<OnlineFixtureValidation> {
  const dois = collectBenchFixtureDois(root);
  const failures: string[] = [];
  let resolved = 0;
  for (const doi of dois) {
    if (await resolveBenchDoi(doi, options)) resolved++;
    else failures.push(doi);
  }
  const total = dois.length;
  const pct = total ? (100 * resolved) / total : 100;
  return {
    ok: pct >= 98,
    total,
    resolved,
    pct,
    failures,
  };
}

export type FixtureIssue = { set: string; id?: string; message: string };

export type FixtureValidation = {
  ok: boolean;
  issues: FixtureIssue[];
  counts: Record<string, number>;
};

function loadArr(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

export function validateBenchFixturesOffline(
  root = process.cwd(),
): FixtureValidation {
  const issues: FixtureIssue[] = [];
  const counts: Record<string, number> = {};
  const questions = new Set<string>();

  const sets: Array<{
    id: string;
    file: string;
    expect: number;
    require: string[];
  }> = [
    {
      id: "1",
      file: "evals/bench/verifiable/items.json",
      expect: 40,
      require: ["id", "question", "checker", "expected", "source"],
    },
    {
      id: "2",
      file: "evals/bench/literature/items.json",
      expect: 30,
      require: ["id", "question", "goldDois", "yearTo", "source"],
    },
    {
      id: "3",
      file: "evals/bench/rediscovery/items.json",
      expect: 15,
      require: [
        "id",
        "goldStatement",
        "requiredTerms",
        "yearTo",
        "source",
        "verified",
      ],
    },
    {
      id: "4",
      file: "evals/bench/validation/items.json",
      expect: 10,
      require: [
        "id",
        "hypothesis",
        "expectedVerdict",
        "resultsFile",
        "predictions",
        "source",
      ],
    },
  ];

  for (const s of sets) {
    const items = loadArr(path.join(root, s.file));
    counts[s.id] = items.length;
    if (items.length !== s.expect) {
      issues.push({
        set: s.id,
        message: `expected ${s.expect} items, got ${items.length}`,
      });
    }
    for (const item of items) {
      const id = String(item.id ?? "?");
      for (const key of s.require) {
        if (item[key] == null) {
          issues.push({ set: s.id, id, message: `missing ${key}` });
        }
      }
      if (!item.source || typeof item.source !== "object") {
        issues.push({ set: s.id, id, message: "source must be an object" });
      } else {
        const src = item.source as Record<string, unknown>;
        if (!src.doi && !src.openalexId && !src.url && !src.arxivId) {
          issues.push({
            set: s.id,
            id,
            message: "source needs doi/openalexId/url/arxivId",
          });
        }
      }
      const q = String(
        item.question ?? item.hypothesis ?? item.goldStatement ?? "",
      );
      if (q) {
        const key = q.toLowerCase().trim();
        if (questions.has(key)) {
          issues.push({
            set: s.id,
            id,
            message: `duplicate question: ${q.slice(0, 80)}`,
          });
        }
        questions.add(key);
      }
      if (s.id === "2") {
        const gold = item.goldDois as unknown;
        if (!Array.isArray(gold) || gold.length < 1) {
          issues.push({ set: s.id, id, message: "goldDois empty" });
        }
      }
      if (s.id === "3" && typeof item.verified !== "boolean") {
        issues.push({ set: s.id, id, message: "verified must be boolean" });
      }
      if (s.id === "4") {
        const rf = String(item.resultsFile ?? "");
        if (rf && !existsSync(path.join(root, rf))) {
          issues.push({ set: s.id, id, message: `missing results file ${rf}` });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues, counts };
}
