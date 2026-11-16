import "server-only";

import { getBenchContext } from "@/lib/server/bench/context";
import { requireOpenRouterApiKey } from "@/lib/server/openrouter";

import {
  enhanceRankedPapers,
  expandSearchQueries,
  resolveSearchStage,
  type SearchStage,
} from "./enhance";
import { mergePapers, normalizeArxivId, normalizeDoi, rrfRank } from "./merge";
import {
  consumeOpenAlexSearchMeta,
  fetchCrossrefWorkDetailed,
  fetchOpenAlexLinks,
  fetchOpenAlexWorkDetailed,
  fetchSemanticScholarLinks,
  fetchSemanticScholarPaperDetailed,
  getOpenAlexMode,
  lookupUnpaywall,
  searchArxiv,
  searchCore,
  searchCrossref,
  searchDblp,
  searchOpenAlex,
  searchOpenAlexSemantic,
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

/** Providers that matter most for LitSearch ML/NLP gold + latency. */
const FAST_PROVIDERS: PaperProvider[] = [
  "openalex",
  "semantic_scholar",
  "arxiv",
  "openreview",
];

const LEAN_ALT: PaperProvider[] = [
  "openalex",
  "semantic_scholar",
  "arxiv",
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
  /** Retrieval quality stage. Default `best` = latency-tuned full pipeline. */
  stage?: SearchStage | string;
  /** OpenRouter key for expand / LLM rerank; falls back to env/settings. */
  apiKey?: string | null;
};

export type SearchPapersResult = {
  papers: Paper[];
  /** Full ranked candidate pool (before output `limit` slice) — for pool recall. */
  pool: Paper[];
  providers: ProviderSearchResult[];
  meta?: {
    stage: SearchStage;
    queries: string[];
    stagesApplied: string[];
    costUsd: number;
    /** OpenAlex usage billed for this search (0 when fully cache-served). */
    openAlexCostUsd: number;
    latencyMs: number;
    poolSize: number;
    oaSemanticUsed: boolean;
    openAlexMode: "full" | "reduced" | "offline";
    reducedCoverage: boolean;
  };
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

async function searchOneQuery(
  q: string,
  common: {
    limit: number;
    signal?: AbortSignal;
    yearFrom?: number;
    yearTo?: number;
    mailto?: string;
  },
  enabled: PaperProvider[],
): Promise<ProviderSearchResult[]> {
  const jobs: Promise<ProviderSearchResult>[] = [];
  if (enabled.includes("openalex")) jobs.push(searchOpenAlex(q, common));
  if (enabled.includes("semantic_scholar"))
    jobs.push(searchSemanticScholar(q, common));
  if (enabled.includes("arxiv")) jobs.push(searchArxiv(q, common));
  if (enabled.includes("dblp")) jobs.push(searchDblp(q, common));
  if (enabled.includes("crossref")) jobs.push(searchCrossref(q, common));
  if (enabled.includes("core")) jobs.push(searchCore(q, common));
  if (enabled.includes("openreview")) jobs.push(searchOpenReview(q, common));
  return Promise.all(jobs);
}

function mergeProviderRuns(
  runs: ProviderSearchResult[][],
): ProviderSearchResult[] {
  const byName = new Map<PaperProvider, ProviderSearchResult>();
  for (const run of runs) {
    for (const r of run) {
      const prev = byName.get(r.provider);
      if (!prev) {
        byName.set(r.provider, { ...r, papers: [...r.papers] });
        continue;
      }
      byName.set(r.provider, {
        provider: r.provider,
        ok: prev.ok || r.ok,
        error: prev.ok
          ? prev.error
          : r.ok
            ? undefined
            : (prev.error ?? r.error),
        papers: mergePapers([prev.papers, r.papers]),
        latencyMs: Math.max(prev.latencyMs, r.latencyMs),
      });
    }
  }
  return [...byName.values()];
}

function stageWantsExpand(stage: SearchStage): boolean {
  return (
    stage === "expand" ||
    stage === "pool" ||
    stage === "semantic" ||
    stage === "hop" ||
    stage === "llm" ||
    stage === "best"
  );
}

function stageWantsOaSemantic(stage: SearchStage): boolean {
  return (
    stage === "pool" ||
    stage === "semantic" ||
    stage === "hop" ||
    stage === "llm" ||
    stage === "best"
  );
}

function stageWantsEnhance(stage: SearchStage): boolean {
  return (
    stage === "semantic" ||
    stage === "hop" ||
    stage === "llm" ||
    stage === "best"
  );
}

export async function searchPapers(
  input: SearchPapersInput,
): Promise<SearchPapersResult> {
  const t0 = Date.now();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const enabled = input.enabledProviders?.length
    ? input.enabledProviders
    : SEARCH_PROVIDERS;
  const mailto = input.contactEmail?.trim() || undefined;
  const q = input.query.trim();
  if (!q) return { papers: [], pool: [], providers: [] };

  // Unit tests stay on baseline (no LLM expand / citation hop / embedder).
  const stage = resolveSearchStage(
    input.stage ?? (process.env.VITEST ? "baseline" : "best"),
  );
  const yearTo = resolveBenchYearTo(input.yearTo, getBenchContext()?.yearTo);

  // Eval/quality stages: grow pools to 50–100. Production `best`: leaner for ≤~20s.
  // Under Vitest, honour the caller's limit so mocked URL assertions stay stable.
  const fetchLimit = process.env.VITEST
    ? limit
    : stage === "best"
      ? 30
      : stage === "baseline"
        ? Math.max(limit, 50)
        : 100;

  // Production hard budget (~20s). Eval may pass a longer signal.
  const prodBudget =
    stage === "best" && !process.env.VITEST
      ? AbortSignal.timeout(18_000)
      : null;
  const signal =
    input.signal && prodBudget
      ? AbortSignal.any([input.signal, prodBudget])
      : (prodBudget ?? input.signal);

  const common = {
    limit: fetchLimit,
    signal,
    yearFrom: input.yearFrom,
    yearTo,
    mailto,
  };

  let apiKey = input.apiKey ?? null;
  if (!apiKey && stageWantsExpand(stage)) {
    try {
      apiKey = await requireOpenRouterApiKey();
    } catch {
      apiKey = null;
    }
  }

  let queries = [q];
  let expandCost = 0;
  if (stageWantsExpand(stage)) {
    const exp = await expandSearchQueries({
      query: q,
      apiKey,
      signal,
    });
    queries = exp.queries.length ? exp.queries : [q];
    // Production: original + 1 short alt for ≤20s.
    if (stage === "best" && queries.length > 2) {
      queries = queries.slice(0, 2);
    }
    expandCost = exp.costUsd;
  }

  const providersForPrimary =
    stage === "best"
      ? FAST_PROVIDERS.filter((p) => enabled.includes(p))
      : enabled;
  const leanAlt = LEAN_ALT.filter((p) => enabled.includes(p));

  // Reset OA cost accumulator for this search.
  consumeOpenAlexSearchMeta();
  const oaModeAtStart = getOpenAlexMode();
  let oaSemanticUsed = false;
  // Keyword multi-query + OpenAlex semantic in parallel (semantic is 1 rps / ~$0.001).
  const keywordPromise = Promise.all(
    queries.map((qq, i) =>
      searchOneQuery(
        qq,
        common,
        i === 0 || leanAlt.length === 0 ? providersForPrimary : leanAlt,
      ),
    ),
  );
  // Semantic: only in full OA budget mode; prod uses one short query.
  const oaSemanticPromise =
    stageWantsOaSemantic(stage) &&
    enabled.includes("openalex") &&
    oaModeAtStart === "full"
      ? (async () => {
          const shorts = queries
            .filter((qq) => qq !== q && qq.trim().split(/\s+/).length <= 16)
            .slice(0, 2);
          const semQueries =
            stage === "best"
              ? [shorts[0] ?? q].slice(0, 1)
              : [q, ...shorts].slice(0, 2);
          const results: ProviderSearchResult[] = [];
          for (const sq of semQueries) {
            if (signal?.aborted) break;
            const sem = await searchOpenAlexSemantic(sq, {
              ...common,
              limit: Math.min(50, fetchLimit),
            });
            if (sem.ok) oaSemanticUsed = true;
            results.push(sem);
          }
          return results.map((r) => [r]) as ProviderSearchResult[][];
        })()
      : Promise.resolve([] as ProviderSearchResult[][]);

  const [keywordRuns, oaSemanticRuns] = await Promise.all([
    keywordPromise,
    oaSemanticPromise,
  ]);

  const providers = mergeProviderRuns([...keywordRuns, ...oaSemanticRuns]);
  const byProviderLists = providers.filter((p) => p.ok).map((p) => p.papers);
  const mergedAll = mergePapers(byProviderLists);
  const ranked = rrfRank(
    byProviderLists.map((list) => list.map((p) => matchMerged(mergedAll, p))),
  );
  let papers = ranked.length ? ranked : mergedAll;

  const stagesApplied: string[] = ["baseline"];
  if (stageWantsExpand(stage)) stagesApplied.push("expand");
  if (oaSemanticUsed) stagesApplied.push("oa_semantic");

  let enhanceCost = 0;
  if (stageWantsEnhance(stage) && !signal?.aborted) {
    const enh = await enhanceRankedPapers({
      query: q,
      ranked: papers,
      stage,
      apiKey,
      signal,
    });
    papers = enh.papers;
    enhanceCost = enh.costUsd;
    for (const s of enh.stagesApplied) {
      if (!stagesApplied.includes(s)) stagesApplied.push(s);
    }
  }

  const oaMeta = consumeOpenAlexSearchMeta();
  const filtered = filterYears(papers, input.yearFrom, yearTo);
  return {
    papers: filtered.slice(0, limit),
    pool: filtered,
    providers,
    meta: {
      stage,
      queries,
      stagesApplied,
      costUsd: expandCost + enhanceCost + oaMeta.costUsd,
      openAlexCostUsd: oaMeta.costUsd,
      latencyMs: Date.now() - t0,
      poolSize: filtered.length,
      oaSemanticUsed,
      openAlexMode: oaMeta.mode,
      reducedCoverage: oaMeta.reducedCoverage || oaModeAtStart !== "full",
    },
  };
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
