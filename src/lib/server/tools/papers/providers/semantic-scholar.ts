import "server-only";

import { getProviderBaseUrl } from "../env";
import { normalizeArxivId, normalizeDoi } from "../merge";
import type { Paper, ProviderSearchResult } from "../types";
import { fetchJson, withSemanticScholarQueue } from "./http";
import {
  arxivIdFromUrl,
  asArr,
  asNum,
  asObj,
  asStr,
  asYear,
  clampLimit,
  cleanText,
  makePaper,
  optionalSecret,
  runProvider,
  userAgent,
  type ProviderSearchOpts,
} from "./util";

const FIELDS =
  "title,year,authors,abstract,venue,externalIds,url,openAccessPdf,citationCount";

/** Normalise one Semantic Scholar paper object. */
export function normalizeSemanticScholarPaper(item: unknown): Paper | null {
  const p = asObj(item);
  const title = cleanText(p.title);
  if (!title) return null;
  const ids = asObj(p.externalIds);
  const oa = asObj(p.openAccessPdf);
  const pdfUrl = asStr(oa.url);
  return makePaper("semantic_scholar", {
    title,
    authors: asArr(p.authors)
      .map((a) => asStr(asObj(a).name))
      .filter((n): n is string => n !== null),
    year: asYear(p.year),
    venue: asStr(p.venue),
    abstract: cleanText(p.abstract),
    doi: asStr(ids.DOI),
    arxivId: normalizeArxivId(asStr(ids.ArXiv)) ?? arxivIdFromUrl(pdfUrl),
    url: asStr(p.url),
    pdfUrl,
    citationCount: asNum(p.citationCount),
  });
}

/** Normalise a `/paper/search` response (`{ data: [...] }`). */
export function normalizeSemanticScholar(raw: unknown): Paper[] {
  const items = Array.isArray(raw) ? raw : asArr(asObj(raw).data);
  return items
    .map(normalizeSemanticScholarPaper)
    .filter((p): p is Paper => p !== null);
}

function headers(mailto?: string): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": userAgent(mailto) };
  const key = optionalSecret("semantic_scholar_api_key");
  if (key) h["x-api-key"] = key;
  return h;
}

function mapFetchError(
  res: { ok: false; error: string; status?: number },
  hasKey: boolean,
): string {
  if (res.error === "rate_limited" && !hasKey) {
    return "rate_limited: add a free Semantic Scholar API key in Settings → Keys (or SEMANTIC_SCHOLAR_API_KEY)";
  }
  return res.error;
}

export async function searchSemanticScholar(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("semantic_scholar", opts, async () => {
    const hasKey = Boolean(optionalSecret("semantic_scholar_api_key"));
    const params = new URLSearchParams({
      query,
      limit: String(clampLimit(opts.limit, 100)),
      fields: FIELDS,
    });
    if (opts.yearFrom !== undefined || opts.yearTo !== undefined) {
      params.set("year", `${opts.yearFrom ?? ""}-${opts.yearTo ?? ""}`);
    }
    const res = await withSemanticScholarQueue(() =>
      fetchJson<unknown>(
        `${getProviderBaseUrl("semantic_scholar")}/paper/search?${params}`,
        { headers: headers(opts.mailto), signal: opts.signal },
      ),
    );
    if (!res.ok) return { ok: false, error: mapFetchError(res, hasKey) };
    return { ok: true, papers: normalizeSemanticScholar(res.data) };
  });
}

/** `DOI:10.x/y` or `ARXIV:1234.5678`, path-safe (colon and slashes kept). */
function paperRef(id: {
  doi?: string | null;
  arxivId?: string | null;
}): string | null {
  const doi = normalizeDoi(id.doi ?? null);
  const arxiv = normalizeArxivId(id.arxivId ?? null);
  const ref = doi ? `DOI:${doi}` : arxiv ? `ARXIV:${arxiv}` : null;
  return ref
    ? encodeURIComponent(ref).replace(/%3A/gi, ":").replace(/%2F/gi, "/")
    : null;
}

type PaperRef = {
  doi?: string | null;
  arxivId?: string | null;
  signal?: AbortSignal;
};

export type SemanticScholarPaperResult = {
  paper: Paper | null;
  answered: boolean;
  error?: string;
};

/** Fetch one paper by DOI or arXiv id with answer/error discrimination. */
export async function fetchSemanticScholarPaperDetailed(
  id: PaperRef,
): Promise<SemanticScholarPaperResult> {
  const ref = paperRef(id);
  if (!ref) return { paper: null, answered: false, error: "empty id" };
  try {
    const res = await withSemanticScholarQueue(() =>
      fetchJson<unknown>(
        `${getProviderBaseUrl("semantic_scholar")}/paper/${ref}?fields=${FIELDS}`,
        { headers: headers(), signal: id.signal },
      ),
    );
    if (!res.ok) {
      const status = res.status;
      if (status === 404) return { paper: null, answered: true };
      return {
        paper: null,
        answered: false,
        error: res.error || `HTTP ${status ?? "?"}`,
      };
    }
    return {
      paper: normalizeSemanticScholarPaper(res.data),
      answered: true,
    };
  } catch (e) {
    return {
      paper: null,
      answered: false,
      error: e instanceof Error ? e.message : "Fetch failed",
    };
  }
}

/** Fetch one paper by DOI or arXiv id. Never throws. */
export async function fetchSemanticScholarPaper(
  id: PaperRef,
): Promise<Paper | null> {
  return (await fetchSemanticScholarPaperDetailed(id)).paper;
}

/** Citations / references of a paper. Never throws (empty on failure). */
export async function fetchSemanticScholarLinks(
  id: PaperRef & { direction: "citations" | "references"; limit: number },
): Promise<Paper[]> {
  const ref = paperRef(id);
  if (!ref) return [];
  try {
    const params = new URLSearchParams({
      fields: FIELDS,
      limit: String(clampLimit(id.limit, 100)),
    });
    const res = await withSemanticScholarQueue(() =>
      fetchJson<unknown>(
        `${getProviderBaseUrl("semantic_scholar")}/paper/${ref}/${id.direction}?${params}`,
        { headers: headers(), signal: id.signal },
      ),
    );
    if (!res.ok) return [];
    return asArr(asObj(res.data).data)
      .map((row) => {
        const r = asObj(row);
        return normalizeSemanticScholarPaper(
          id.direction === "citations" ? r.citingPaper : r.citedPaper,
        );
      })
      .filter((p): p is Paper => p !== null);
  } catch {
    return [];
  }
}
