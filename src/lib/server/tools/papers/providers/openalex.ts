import "server-only";

import { getProviderBaseUrl } from "../env";
import { normalizeArxivId, normalizeDoi } from "../merge";
import type { Paper, ProviderSearchResult } from "../types";
import { fetchJson, withOpenAlexQueue } from "./http";
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
  if (res.error === "rate_limited" && !hasKey) {
    return "rate_limited: add a free OpenAlex API key in Settings → Keys (or OPENALEX_API_KEY)";
  }
  return res.error;
}

export async function searchOpenAlex(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("openalex", opts, async () => {
    const hasKey = Boolean(optionalSecret("openalex_api_key"));
    const params = authParams(opts.mailto);
    params.set("search", query);
    params.set("per_page", String(clampLimit(opts.limit, 200)));
    const filters: string[] = [];
    if (opts.yearFrom !== undefined) {
      filters.push(`from_publication_date:${opts.yearFrom}-01-01`);
    }
    if (opts.yearTo !== undefined) {
      filters.push(`to_publication_date:${opts.yearTo}-12-31`);
    }
    if (filters.length > 0) params.set("filter", filters.join(","));
    const res = await withOpenAlexQueue(() =>
      fetchJson<unknown>(`${getProviderBaseUrl("openalex")}/works?${params}`, {
        headers: { "User-Agent": userAgent(opts.mailto) },
        signal: opts.signal,
      }),
    );
    if (!res.ok) return { ok: false, error: mapFetchError(res, hasKey) };
    return { ok: true, papers: normalizeOpenAlex(res.data) };
  });
}

type WorkRef = {
  doi?: string | null;
  arxivId?: string | null;
  mailto?: string;
  signal?: AbortSignal;
};

export type OpenAlexWorkResult = {
  openAlexId: string | null;
  paper: Paper | null;
  answered: boolean;
  error?: string;
};

/** Look up one work by DOI (or arXiv id via its DataCite DOI). Never throws. */
async function lookupWork(ref: WorkRef): Promise<OpenAlexWorkResult> {
  try {
    const arxiv = normalizeArxivId(ref.arxivId ?? null);
    const doi =
      normalizeDoi(ref.doi ?? null) ??
      (arxiv ? `10.48550/arxiv.${arxiv}` : null);
    if (!doi) {
      return {
        openAlexId: null,
        paper: null,
        answered: false,
        error: "empty doi",
      };
    }
    const res = await withOpenAlexQueue(() =>
      fetchJson<unknown>(
        `${getProviderBaseUrl("openalex")}/works/doi:${encodeDoiPath(doi)}?${authParams(ref.mailto)}`,
        {
          headers: { "User-Agent": userAgent(ref.mailto) },
          signal: ref.signal,
        },
      ),
    );
    if (!res.ok) {
      const status = res.status;
      if (status === 404) {
        return { openAlexId: null, paper: null, answered: true };
      }
      return {
        openAlexId: null,
        paper: null,
        answered: false,
        error: res.error || `HTTP ${status ?? "?"}`,
      };
    }
    const rawId = asStr(asObj(res.data).id);
    return {
      openAlexId: rawId ? (rawId.split("/").pop() ?? null) : null,
      paper: normalizeWork(res.data),
      answered: true,
    };
  } catch (e) {
    return {
      openAlexId: null,
      paper: null,
      answered: false,
      error: e instanceof Error ? e.message : "Fetch failed",
    };
  }
}

/** Fetch one work by DOI or arXiv id. Never throws. */
export async function fetchOpenAlexWork(ref: WorkRef): Promise<Paper | null> {
  return (await lookupWork(ref)).paper;
}

/** Fetch one work with answered/error discrimination. Never throws. */
export async function fetchOpenAlexWorkDetailed(
  ref: WorkRef,
): Promise<OpenAlexWorkResult> {
  return lookupWork(ref);
}

/** Citations / references of a work (fallback when Semantic Scholar has none). Never throws. */
export async function fetchOpenAlexLinks(
  ref: WorkRef & { direction: "citations" | "references"; limit: number },
): Promise<Paper[]> {
  try {
    const { openAlexId } = await lookupWork(ref);
    if (!openAlexId) return [];
    const params = authParams(ref.mailto);
    params.set(
      "filter",
      ref.direction === "citations"
        ? `cites:${openAlexId}`
        : `cited_by:${openAlexId}`,
    );
    params.set("per_page", String(clampLimit(ref.limit, 200)));
    const res = await withOpenAlexQueue(() =>
      fetchJson<unknown>(`${getProviderBaseUrl("openalex")}/works?${params}`, {
        headers: { "User-Agent": userAgent(ref.mailto) },
        signal: ref.signal,
      }),
    );
    return res.ok ? normalizeOpenAlex(res.data) : [];
  } catch {
    return [];
  }
}
