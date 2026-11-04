import "server-only";

import { getBenchContext } from "@/lib/server/bench/context";

import { mergePapers, normalizeArxivId, normalizeDoi, rrfRank } from "./merge";
import {
  fetchCrossrefWorkDetailed,
  fetchOpenAlexLinks,
  fetchOpenAlexWorkDetailed,
  fetchSemanticScholarLinks,
  fetchSemanticScholarPaperDetailed,
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

export type ProviderLookupAttempt = {
  provider: PaperProvider;
  answered: boolean;
  error?: string;
};

export type GetPaperResult = {
  paper: Paper | null;
  attempts: ProviderLookupAttempt[];
};

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

export async function getPaperDetailed(input: {
  doi?: string;
  arxivId?: string;
  contactEmail?: string | null;
  signal?: AbortSignal;
  /** When set, only these providers are queried (e.g. keyless Crossref+arXiv). */
  enabledProviders?: PaperProvider[];
}): Promise<GetPaperResult> {
  const doi = normalizeDoi(input.doi);
  const arxivId = normalizeArxivId(input.arxivId);
  if (!doi && !arxivId) return { paper: null, attempts: [] };

  const enabled = input.enabledProviders?.length
    ? new Set(input.enabledProviders)
    : null;
  const allows = (p: PaperProvider) => !enabled || enabled.has(p);
  const mailto = input.contactEmail?.trim() || undefined;

  type Job = Promise<{
    paper: Paper | null;
    attempt: ProviderLookupAttempt;
  }>;
  const jobs: Job[] = [];

  if (doi) {
    if (allows("openalex")) {
      jobs.push(
        fetchOpenAlexWorkDetailed({ doi, signal: input.signal, mailto }).then(
          (r) => ({
            paper: r.paper,
            attempt: {
              provider: "openalex" as const,
              answered: r.answered,
              error: r.error,
            },
          }),
        ),
      );
    }
    if (allows("semantic_scholar")) {
      jobs.push(
        fetchSemanticScholarPaperDetailed({
          doi,
          signal: input.signal,
        }).then((r) => ({
          paper: r.paper,
          attempt: {
            provider: "semantic_scholar" as const,
            answered: r.answered,
            error: r.error,
          },
        })),
      );
    }
    if (allows("crossref")) {
      jobs.push(
        fetchCrossrefWorkDetailed({
          doi,
          signal: input.signal,
          mailto,
        }).then((r) => ({
          paper: r.paper,
          attempt: {
            provider: "crossref" as const,
            answered: r.answered,
            error: r.error,
          },
        })),
      );
    }
    const arxivFromDoi = doi.toLowerCase().startsWith("10.48550/arxiv.")
      ? normalizeArxivId(doi.slice("10.48550/arxiv.".length))
      : null;
    if (arxivFromDoi && allows("arxiv")) {
      jobs.push(
        searchArxiv(arxivFromDoi, { limit: 1, signal: input.signal }).then(
          (r) => ({
            paper: r.ok ? (r.papers[0] ?? null) : null,
            attempt: {
              provider: "arxiv" as const,
              answered: r.ok,
              error: r.ok ? undefined : (r.error ?? "error"),
            },
          }),
        ),
      );
    }
  } else if (arxivId) {
    if (allows("openalex")) {
      jobs.push(
        fetchOpenAlexWorkDetailed({
          arxivId,
          signal: input.signal,
          mailto,
        }).then((r) => ({
          paper: r.paper,
          attempt: {
            provider: "openalex" as const,
            answered: r.answered,
            error: r.error,
          },
        })),
      );
    }
    if (allows("semantic_scholar")) {
      jobs.push(
        fetchSemanticScholarPaperDetailed({
          arxivId,
          signal: input.signal,
        }).then((r) => ({
          paper: r.paper,
          attempt: {
            provider: "semantic_scholar" as const,
            answered: r.answered,
            error: r.error,
          },
        })),
      );
    }
    if (allows("arxiv")) {
      jobs.push(
        searchArxiv(arxivId, { limit: 1, signal: input.signal }).then((r) => ({
          paper: r.ok ? (r.papers[0] ?? null) : null,
          attempt: {
            provider: "arxiv" as const,
            answered: r.ok,
            error: r.ok ? undefined : (r.error ?? "error"),
          },
        })),
      );
    }
    if (enabled?.has("crossref")) {
      jobs.push(
        fetchCrossrefWorkDetailed({
          doi: `10.48550/arxiv.${arxivId}`,
          signal: input.signal,
          mailto,
        }).then((r) => ({
          paper: r.paper,
          attempt: {
            provider: "crossref" as const,
            answered: r.answered,
            error: r.error,
          },
        })),
      );
    }
  }

  const settled = await Promise.all(jobs);
  const attempts = settled.map((s) => s.attempt);
  const parts = settled
    .map((s) => s.paper)
    .filter((p): p is Paper => Boolean(p));

  if (parts.length === 0) return { paper: null, attempts };
  let paper = mergePapers([parts])[0] ?? null;
  if (!paper) return { paper: null, attempts };

  if (paper.doi && input.contactEmail) {
    const oa = await lookupUnpaywall(paper.doi, {
      email: input.contactEmail,
      signal: input.signal,
    });
    if (oa?.pdfUrl) paper = { ...paper, pdfUrl: oa.pdfUrl };
  }
  return { paper, attempts };
}

export async function getPaper(input: {
  doi?: string;
  arxivId?: string;
  contactEmail?: string | null;
  signal?: AbortSignal;
  /** When set, only these providers are queried (e.g. keyless Crossref+arXiv). */
  enabledProviders?: PaperProvider[];
}): Promise<Paper | null> {
  return (await getPaperDetailed(input)).paper;
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
