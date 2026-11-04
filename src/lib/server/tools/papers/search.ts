import "server-only";

import { getBenchContext } from "@/lib/server/bench/context";

import { mergePapers, normalizeArxivId, normalizeDoi, rrfRank } from "./merge";
import {
  fetchCrossrefWork,
  fetchOpenAlexLinks,
  fetchOpenAlexWork,
  fetchSemanticScholarLinks,
  fetchSemanticScholarPaper,
  lookupUnpaywall,
  searchArxiv,
  searchCore,
  searchCrossref,
  searchDblp,
  searchOpenAlex,
  searchOpenReview,
  searchSemanticScholar,
} from "./providers";
import type { Paper, PaperProvider, ProviderSearchResult } from "./types";

export const SEARCH_PROVIDERS: PaperProvider[] = [
  "openalex",
  "semantic_scholar",
  "arxiv",
  "dblp",
  "crossref",
  "core",
  "openreview",
];

export type SearchPapersInput = {
  query: string;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  contactEmail?: string | null;
  enabledProviders?: PaperProvider[];
  signal?: AbortSignal;
};

/** Merge caller yearTo with an optional bench ceiling (never later than bench). */
export function resolveBenchYearTo(
  inputYearTo: number | undefined,
  benchYearTo: number | undefined,
): number | undefined {
  if (benchYearTo == null) return inputYearTo;
  return Math.min(inputYearTo ?? benchYearTo, benchYearTo);
}

function filterYears(
  papers: Paper[],
  yearFrom?: number,
  yearTo?: number,
): Paper[] {
  return papers.filter((p) => {
    if (p.year == null) return true;
    if (yearFrom != null && p.year < yearFrom) return false;
    if (yearTo != null && p.year > yearTo) return false;
    return true;
  });
}

function matchMerged(merged: Paper[], p: Paper): Paper {
  return (
    merged.find(
      (m) =>
        (m.doi && p.doi && m.doi === p.doi) ||
        (m.arxivId && p.arxivId && m.arxivId === p.arxivId) ||
        m.title.toLowerCase() === p.title.toLowerCase(),
    ) ?? p
  );
}

export async function searchPapers(
  input: SearchPapersInput,
): Promise<{ papers: Paper[]; providers: ProviderSearchResult[] }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const enabled = input.enabledProviders?.length
    ? input.enabledProviders
    : SEARCH_PROVIDERS;
  const mailto = input.contactEmail?.trim() || undefined;
  const q = input.query.trim();
  if (!q) return { papers: [], providers: [] };

  // Bench rediscovery: enforce yearTo ceiling even if the model omits it.
  const yearTo = resolveBenchYearTo(input.yearTo, getBenchContext()?.yearTo);

  const common = {
    limit,
    signal: input.signal,
    yearFrom: input.yearFrom,
    yearTo,
    mailto,
  };

  const jobs: Promise<ProviderSearchResult>[] = [];
  if (enabled.includes("openalex")) jobs.push(searchOpenAlex(q, common));
  if (enabled.includes("semantic_scholar"))
    jobs.push(searchSemanticScholar(q, common));
  if (enabled.includes("arxiv")) jobs.push(searchArxiv(q, common));
  if (enabled.includes("dblp")) jobs.push(searchDblp(q, common));
  if (enabled.includes("crossref")) jobs.push(searchCrossref(q, common));
  if (enabled.includes("core")) jobs.push(searchCore(q, common));
  if (enabled.includes("openreview")) jobs.push(searchOpenReview(q, common));

  const providers = await Promise.all(jobs);
  const byProviderLists = providers.filter((p) => p.ok).map((p) => p.papers);
  const mergedAll = mergePapers(byProviderLists);
  const ranked = rrfRank(
    byProviderLists.map((list) => list.map((p) => matchMerged(mergedAll, p))),
  );
  const filtered = filterYears(
    ranked.length ? ranked : mergedAll,
    input.yearFrom,
    yearTo,
  );
  return { papers: filtered.slice(0, limit), providers };
}

export async function getPaper(input: {
  doi?: string;
  arxivId?: string;
  contactEmail?: string | null;
  signal?: AbortSignal;
  /** When set, only these providers are queried (e.g. keyless Crossref+arXiv). */
  enabledProviders?: PaperProvider[];
}): Promise<Paper | null> {
  const doi = normalizeDoi(input.doi);
  const arxivId = normalizeArxivId(input.arxivId);
  if (!doi && !arxivId) return null;

  const enabled = input.enabledProviders?.length
    ? new Set(input.enabledProviders)
    : null;
  const allows = (p: PaperProvider) => !enabled || enabled.has(p);
  const mailto = input.contactEmail?.trim() || undefined;

  const parts: Paper[] = [];
  if (doi) {
    const jobs: Promise<Paper | null>[] = [];
    if (allows("openalex"))
      jobs.push(fetchOpenAlexWork({ doi, signal: input.signal, mailto }));
    if (allows("semantic_scholar"))
      jobs.push(fetchSemanticScholarPaper({ doi, signal: input.signal }));
    if (allows("crossref"))
      jobs.push(fetchCrossrefWork({ doi, signal: input.signal, mailto }));
    // arXiv-minted DOIs resolve via the arXiv API when enabled.
    const arxivFromDoi = doi.toLowerCase().startsWith("10.48550/arxiv.")
      ? normalizeArxivId(doi.slice("10.48550/arxiv.".length))
      : null;
    if (arxivFromDoi && allows("arxiv")) {
      jobs.push(
        searchArxiv(arxivFromDoi, { limit: 1, signal: input.signal }).then(
          (r) => r.papers[0] ?? null,
        ),
      );
    }
    for (const p of await Promise.all(jobs)) {
      if (p) parts.push(p);
    }
  } else if (arxivId) {
    const jobs: Promise<Paper | null>[] = [];
    if (allows("openalex"))
      jobs.push(fetchOpenAlexWork({ arxivId, signal: input.signal, mailto }));
    if (allows("semantic_scholar"))
      jobs.push(fetchSemanticScholarPaper({ arxivId, signal: input.signal }));
    if (allows("arxiv")) {
      jobs.push(
        searchArxiv(arxivId, { limit: 1, signal: input.signal }).then(
          (r) => r.papers[0] ?? null,
        ),
      );
    }
    // Crossref only when explicitly enabled (keyless mode) — avoid surprise
    // network calls on default getPaper(arxivId) paths used in tests/tools.
    if (enabled?.has("crossref")) {
      jobs.push(
        fetchCrossrefWork({
          doi: `10.48550/arxiv.${arxivId}`,
          signal: input.signal,
          mailto,
        }),
      );
    }
    for (const p of await Promise.all(jobs)) {
      if (p) parts.push(p);
    }
  }

  if (parts.length === 0) return null;
  let paper = mergePapers([parts])[0] ?? null;
  if (!paper) return null;

  if (paper.doi && input.contactEmail) {
    const oa = await lookupUnpaywall(paper.doi, {
      email: input.contactEmail,
      signal: input.signal,
    });
    if (oa?.pdfUrl) paper = { ...paper, pdfUrl: oa.pdfUrl };
  }
  return paper;
}

export async function paperLinks(input: {
  doi?: string;
  arxivId?: string;
  direction: "citations" | "references";
  limit?: number;
  signal?: AbortSignal;
}): Promise<Paper[]> {
  const limit = Math.min(input.limit ?? 20, 50);
  const doi = normalizeDoi(input.doi);
  const arxivId = normalizeArxivId(input.arxivId);
  if (!doi && !arxivId) return [];

  const fromS2 = await fetchSemanticScholarLinks({
    doi: doi ?? undefined,
    arxivId: arxivId ?? undefined,
    direction: input.direction,
    limit,
    signal: input.signal,
  });
  if (fromS2.length > 0) return fromS2.slice(0, limit);

  const fromOa = await fetchOpenAlexLinks({
    doi: doi ?? undefined,
    arxivId: arxivId ?? undefined,
    direction: input.direction,
    limit,
    signal: input.signal,
  });
  return fromOa.slice(0, limit);
}
