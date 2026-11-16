import "server-only";

import { getProviderBaseUrl } from "../env";
import { normalizeArxivId, normalizeDoi } from "../merge";
import type { Paper, ProviderSearchResult } from "../types";
import { withOpenAlexQueue } from "./http";
import {
  getOpenAlexMode,
  noteOpenAlexHeaders,
  OA_COST_SEARCH_USD,
  OA_COST_SEMANTIC_USD,
  type OpenAlexMode,
} from "./openalex-budget";
import { fetchOpenAlexCached } from "./openalex-cache";
import {
  arxivIdFromDoi,
  arxivIdFromUrl,
  asArr,
  asNum,
  asObj,
  asStr,
  asYear,
  clampLimit,
  cleanText,
  encodeDoiPath,
  makePaper,
  optionalSecret,
  runProvider,
  userAgent,
  type ProviderSearchOpts,
} from "./util";

export type OpenAlexSearchMeta = {
  mode: OpenAlexMode;
  costUsd: number;
  fromCache: boolean;
  reducedCoverage: boolean;
};

/** Last search's OA accounting (read by searchPapers). */
let lastSearchMeta: OpenAlexSearchMeta = {
  mode: "full",
  costUsd: 0,
  fromCache: true,
  reducedCoverage: false,
};

export function consumeOpenAlexSearchMeta(): OpenAlexSearchMeta {
  const m = lastSearchMeta;
  lastSearchMeta = {
    mode: getOpenAlexMode(),
    costUsd: 0,
    fromCache: true,
    reducedCoverage: m.mode !== "full",
  };
  return m;
}

function noteCost(costUsd: number, fromCache: boolean) {
  lastSearchMeta = {
    mode: getOpenAlexMode(),
    costUsd: lastSearchMeta.costUsd + (fromCache ? 0 : costUsd),
    fromCache: lastSearchMeta.fromCache && fromCache,
    reducedCoverage: getOpenAlexMode() !== "full",
  };
}

function invertedIndexToText(index: unknown): string | null {
  const slots: [number, string][] = [];
  for (const [word, positions] of Object.entries(asObj(index))) {
    for (const pos of asArr(positions)) {
      const n = asNum(pos);
      if (n !== null) slots.push([n, word]);
    }
  }
  if (slots.length === 0) return null;
  slots.sort((a, b) => a[0] - b[0]);
  return slots.map(([, w]) => w).join(" ");
}

function normalizeWork(item: unknown): Paper | null {
  const w = asObj(item);
  const title = cleanText(w.title ?? w.display_name);
  if (!title) return null;

  const doi = normalizeDoi(asStr(w.doi));
  const primary = asObj(w.primary_location);
  const source = asObj(primary.source);
  const bestOa = asObj(w.best_oa_location);
  const oa = asObj(w.open_access);

  let arxivId = arxivIdFromDoi(doi);
  if (!arxivId) {
    for (const loc of asArr(w.locations)) {
      const l = asObj(loc);
      arxivId =
        arxivIdFromUrl(asStr(l.landing_page_url)) ??
        arxivIdFromUrl(asStr(l.pdf_url));
      if (arxivId) break;
    }
  }

  return makePaper("openalex", {
    title,
    authors: asArr(w.authorships)
      .map((a) => asStr(asObj(asObj(a).author).display_name))
      .filter((n): n is string => n !== null),
    year: asYear(w.publication_year),
    venue: asStr(source.display_name),
    abstract: invertedIndexToText(w.abstract_inverted_index),
    doi,
    arxivId,
    url:
      asStr(primary.landing_page_url) ??
      (doi ? `https://doi.org/${doi}` : null) ??
      asStr(w.id),
    pdfUrl: asStr(bestOa.pdf_url) ?? asStr(primary.pdf_url) ?? asStr(oa.oa_url),
    citationCount: asNum(w.cited_by_count),
  });
}

/** Normalise an OpenAlex `/works` response (`{ results: [...] }`). */
export function normalizeOpenAlex(raw: unknown): Paper[] {
  const items = Array.isArray(raw) ? raw : asArr(asObj(raw).results);
  return items.map(normalizeWork).filter((p): p is Paper => p !== null);
}

function authParams(mailto?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (mailto) params.set("mailto", mailto);
  const key = optionalSecret("openalex_api_key");
  if (key) params.set("api_key", key);
  return params;
}

function mapFetchError(
  res: { ok: false; error: string; status?: number },
  hasKey: boolean,
): string {
  if (res.error === "rate_limited") {
    if (!hasKey) {
      return "rate_limited: add a free OpenAlex API key in Settings → Keys (or OPENALEX_API_KEY)";
    }
    return "rate_limited: openalex_daily_budget_exhausted";
  }
  return res.error;
}

function yearFilters(opts: ProviderSearchOpts): string[] {
  const filters: string[] = [];
  if (opts.yearFrom !== undefined) {
    filters.push(`from_publication_date:${opts.yearFrom}-01-01`);
  }
  if (opts.yearTo !== undefined) {
    filters.push(`to_publication_date:${opts.yearTo}-12-31`);
  }
  return filters;
}

/** Keyword search; paginates up to `opts.limit` (max 100). Respects OA budget mode. */
export async function searchOpenAlex(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("openalex", opts, async () => {
    const hasKey = Boolean(optionalSecret("openalex_api_key"));
    const mode = getOpenAlexMode();
    const want = clampLimit(
      mode === "offline" || mode === "reduced"
        ? Math.min(opts.limit, 25)
        : opts.limit,
      mode === "full" ? 100 : 25,
    );
    const perPage = Math.min(want, mode === "full" ? 100 : 25);
    const papers: Paper[] = [];
    let cursor: string | null = "*";
    let pages = 0;
    const maxPages = mode === "full" ? 4 : 1;
    while (papers.length < want && cursor && pages < maxPages) {
      const params = authParams(opts.mailto);
      params.set("search", query);
      params.set("per_page", String(perPage));
      params.set("cursor", cursor);
      const filters = yearFilters(opts);
      if (filters.length > 0) params.set("filter", filters.join(","));
      const url = `${getProviderBaseUrl("openalex")}/works?${params}`;
      // Offline: cache hits only (bypassCache false; network 429 → fail that page).
      const res = await withOpenAlexQueue(() =>
        fetchOpenAlexCached(url, {
          headers: { "User-Agent": userAgent(opts.mailto) },
          signal: opts.signal,
          cacheOnly: mode === "offline",
        }),
      );
      pages += 1;
      if (!res.ok) {
        if (papers.length) break;
        return {
          ok: false,
          error:
            mode === "offline"
              ? "openalex_daily_budget_exhausted"
              : mapFetchError(res, hasKey),
        };
      }
      noteCost(OA_COST_SEARCH_USD, Boolean(res.fromCache));
      const batch = normalizeOpenAlex(res.data);
      papers.push(...batch);
      const next = asStr(asObj(asObj(res.data).meta).next_cursor);
      cursor = next && batch.length > 0 ? next : null;
      if (batch.length < perPage) break;
      if (mode !== "full") break;
    }
    if (!papers.length && mode === "offline") {
      return { ok: false, error: "openalex_daily_budget_exhausted" };
    }
    return { ok: true, papers: papers.slice(0, want) };
  });
}

/**
 * OpenAlex semantic/vector search (`search.semantic`).
 * Skipped in reduced/offline budget modes.
 */
export async function searchOpenAlexSemantic(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("openalex", opts, async () => {
    const hasKey = Boolean(optionalSecret("openalex_api_key"));
    if (!hasKey) {
      return {
        ok: false,
        error: "openalex_semantic_requires_api_key",
      };
    }
    const mode = getOpenAlexMode();
    if (mode !== "full") {
      return {
        ok: false,
        error:
          mode === "offline"
            ? "openalex_daily_budget_exhausted"
            : "openalex_reduced_coverage_skip_semantic",
      };
    }
    const params = authParams(opts.mailto);
    params.set("search.semantic", query.slice(0, 2000));
    params.set("per_page", String(clampLimit(Math.min(opts.limit, 50), 50)));
    const filters = yearFilters(opts);
    if (filters.length > 0) params.set("filter", filters.join(","));
    const url = `${getProviderBaseUrl("openalex")}/works?${params}`;
    const res = await withOpenAlexQueue(() =>
      fetchOpenAlexCached(url, {
        headers: { "User-Agent": userAgent(opts.mailto) },
        signal: opts.signal,
      }),
    );
    if (!res.ok) return { ok: false, error: mapFetchError(res, hasKey) };
    noteCost(OA_COST_SEMANTIC_USD, Boolean(res.fromCache));
    return { ok: true, papers: normalizeOpenAlex(res.data) };
  });
}

type WorkRef = {
  doi?: string | null;
  arxivId?: string | null;
  mailto?: string;
  signal?: AbortSignal;
};

async function lookupWork(
  ref: WorkRef,
): Promise<{ openAlexId: string | null; paper: Paper | null }> {
  try {
    const arxiv = normalizeArxivId(ref.arxivId ?? null);
    const doi =
      normalizeDoi(ref.doi ?? null) ??
      (arxiv ? `10.48550/arxiv.${arxiv}` : null);
    if (!doi) return { openAlexId: null, paper: null };
    const url = `${getProviderBaseUrl("openalex")}/works/doi:${encodeDoiPath(doi)}?${authParams(ref.mailto)}`;
    const res = await withOpenAlexQueue(() =>
      fetchOpenAlexCached(url, {
        headers: { "User-Agent": userAgent(ref.mailto) },
        signal: ref.signal,
      }),
    );
    if (!res.ok) return { openAlexId: null, paper: null };
    const rawId = asStr(asObj(res.data).id);
    return {
      openAlexId: rawId ? (rawId.split("/").pop() ?? null) : null,
      paper: normalizeWork(res.data),
    };
  } catch {
    return { openAlexId: null, paper: null };
  }
}

export async function fetchOpenAlexWork(ref: WorkRef): Promise<Paper | null> {
  return (await lookupWork(ref)).paper;
}

export async function fetchOpenAlexLinks(
  ref: WorkRef & { direction: "citations" | "references"; limit: number },
): Promise<Paper[]> {
  try {
    const { openAlexId } = await lookupWork(ref);
    if (!openAlexId) return [];
    if (getOpenAlexMode() === "offline") return [];
    const params = authParams(ref.mailto);
    params.set(
      "filter",
      ref.direction === "citations"
        ? `cites:${openAlexId}`
        : `cited_by:${openAlexId}`,
    );
    params.set("per_page", String(clampLimit(ref.limit, 200)));
    const url = `${getProviderBaseUrl("openalex")}/works?${params}`;
    const res = await withOpenAlexQueue(() =>
      fetchOpenAlexCached(url, {
        headers: { "User-Agent": userAgent(ref.mailto) },
        signal: ref.signal,
      }),
    );
    return res.ok ? normalizeOpenAlex(res.data) : [];
  } catch {
    return [];
  }
}

/** Probe budget with a free-ish singleton call (or headers from any response). */
export async function refreshOpenAlexBudget(): Promise<{
  remainingUsd: number;
  limitUsd: number;
  resetAtMs: number | null;
  mode: OpenAlexMode;
  line: string;
}> {
  const { formatOpenAlexBudgetLine, loadOpenAlexBudget } =
    await import("./openalex-budget");
  const key = optionalSecret("openalex_api_key");
  if (key) {
    try {
      const url = `${getProviderBaseUrl("openalex")}/works?per_page=1&api_key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent() },
      });
      noteOpenAlexHeaders(res.headers);
    } catch {
      /* keep last known */
    }
  }
  const b = loadOpenAlexBudget();
  return {
    remainingUsd: b.remainingUsd,
    limitUsd: b.limitUsd,
    resetAtMs: b.resetAtMs,
    mode: getOpenAlexMode(),
    line: formatOpenAlexBudgetLine(b),
  };
}
