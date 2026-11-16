import "server-only";

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateText, Output } from "ai";
import { z } from "zod";

import { loadDefaults } from "@/lib/server/defaults";
import { getEmbedder } from "@/lib/server/memory/embedder";
import { cosine } from "@/lib/server/memory/vector";
import { createOpenRouterClient } from "@/lib/server/openrouter";
import { getAppDataDir } from "@/lib/server/paths";

const expandQueriesSchema = z.object({
  queries: z.array(z.string().min(3).max(160)).min(3).max(5),
});

import { mergePapers, normalizeArxivId, normalizeDoi, rrfRank } from "./merge";
import { fetchOpenAlexLinks, fetchSemanticScholarLinks } from "./providers";
import type { Paper } from "./types";

type ExpandCacheEntry = { queries: string[]; costUsd: number };

let expandMemCache: Record<string, ExpandCacheEntry> | null = null;

function expandCachePath(): string {
  const dir = path.join(getAppDataDir(), "cache");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "paper-expand-queries.json");
}

function loadExpandCache(): Record<string, ExpandCacheEntry> {
  if (expandMemCache) return expandMemCache;
  const p = expandCachePath();
  if (!existsSync(p)) {
    expandMemCache = {};
    return expandMemCache;
  }
  try {
    expandMemCache = JSON.parse(readFileSync(p, "utf8")) as Record<
      string,
      ExpandCacheEntry
    >;
  } catch {
    expandMemCache = {};
  }
  return expandMemCache;
}

function persistExpandCache() {
  if (!expandMemCache) return;
  writeFileSync(expandCachePath(), JSON.stringify(expandMemCache) + "\n");
}

function expandCacheKey(query: string, model: string): string {
  return createHash("sha256")
    .update(`v2\n${model}\n${query.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

async function hopLinks(input: {
  doi?: string;
  arxivId?: string;
  direction: "citations" | "references";
  limit: number;
  signal?: AbortSignal;
}): Promise<Paper[]> {
  const doi = normalizeDoi(input.doi);
  const arxivId = normalizeArxivId(input.arxivId);
  if (!doi && !arxivId) return [];
  const fromS2 = await fetchSemanticScholarLinks({
    doi: doi ?? undefined,
    arxivId: arxivId ?? undefined,
    direction: input.direction,
    limit: input.limit,
    signal: input.signal,
  });
  if (fromS2.length > 0) return fromS2.slice(0, input.limit);
  const fromOa = await fetchOpenAlexLinks({
    doi: doi ?? undefined,
    arxivId: arxivId ?? undefined,
    direction: input.direction,
    limit: input.limit,
    signal: input.signal,
  });
  return fromOa.slice(0, input.limit);
}

/**
 * Cumulative retrieval combinations:
 * - baseline / expand / pool: candidate growth (RRF merge)
 * - semantic: pool + Qwen rerank (top 150 by RRF)
 * - llm: semantic + LLM rerank (top 50)
 * - hop: + citation hop (optional; often too slow for ≤20s)
 * - best: latency-tuned shipped default (≤~20s)
 */
export type SearchStage =
  "baseline" | "expand" | "pool" | "semantic" | "hop" | "llm" | "best";

/** RRF shortlist size before local embedding rerank. */
export const RERANK_POOL_SIZE = 150;
/** LLM rerank looks at this many after Qwen. */
export const LLM_RERANK_TOP_N = 50;

/** Stages included in the shipped default (latency-tuned in search; no hop). */
export const SHIPPED_SEARCH_STAGES: SearchStage[] = [
  "expand",
  "pool",
  "semantic",
];

export function resolveSearchStage(stage?: string | null): SearchStage {
  const s = (stage ?? "best").trim().toLowerCase();
  if (
    s === "baseline" ||
    s === "expand" ||
    s === "pool" ||
    s === "semantic" ||
    s === "hop" ||
    s === "llm" ||
    s === "best"
  ) {
    return s;
  }
  return "best";
}

function paperEnhanceModel(): string {
  const d = loadDefaults();
  return (
    d.paperEnhanceModel?.trim() ||
    d.classifierModel?.trim() ||
    "~google/gemini-flash-latest"
  );
}

/** Expand needs a non-reasoning JSON model; gemini-flash burns tokens on reasoning. */
function paperExpandModel(): string {
  const d = loadDefaults();
  return (
    d.classifierModel?.trim() ||
    d.paperEnhanceModel?.trim() ||
    "~openai/gpt-latest"
  );
}

export async function expandSearchQueries(input: {
  query: string;
  apiKey?: string | null;
  signal?: AbortSignal;
}): Promise<{ queries: string[]; costUsd: number }> {
  const q = input.query.trim();
  if (!q) return { queries: [], costUsd: 0 };
  if (!input.apiKey) return { queries: [q], costUsd: 0 };

  const modelId = paperExpandModel();
  const cacheKey = expandCacheKey(q, modelId);
  const cache = loadExpandCache();
  const hit = cache[cacheKey];
  if (hit?.queries?.length) {
    return { queries: hit.queries, costUsd: 0 };
  }

  try {
    const openrouter = createOpenRouterClient(input.apiKey);
    const model = openrouter(modelId, { usage: { include: true } });
    const result = await generateText({
      model,
      maxOutputTokens: 1024,
      temperature: 0,
      output: Output.object({ schema: expandQueriesSchema }),
      system: `Expand a literature-search question into 5 short academic search queries.
Each query MUST be ≤ 12 words. Never return the original question. Never start with "are there" / "papers on".
Always include:
- compact keywords (methods, datasets, tasks)
- a classic-model rephrase (BERT/Transformer) if the topic is pre-LLM-era NLP
- one guessed landmark paper title (real title if known)

Example for distillation/compression of BERT-era models:
["task-agnostic knowledge distillation BERT",
 "TinyBERT Distilling BERT for Natural Language Understanding",
 "knowledge distillation pretrained language model compression",
 "DistilBERT distilled bidirectional transformers",
 "task-specific distillation BERT student teacher"]`,
      prompt: q.slice(0, 2000),
      abortSignal: input.signal,
    });
    const cost =
      (
        (await result.providerMetadata)?.openrouter as
          { usage?: { cost?: number } } | undefined
      )?.usage?.cost ?? 0;
    const list = (result.output?.queries ?? [])
      .map((x) => x.trim())
      .filter(Boolean);
    const heuristic = heuristicExpandQueries(q);
    const queries = [
      q,
      ...list.filter((x) => x.toLowerCase() !== q.toLowerCase()),
      ...heuristic,
    ];
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const item of queries) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(item);
    }
    const out = {
      queries: uniq.slice(0, 6),
      costUsd: typeof cost === "number" ? cost : 0,
    };
    cache[cacheKey] = { queries: out.queries, costUsd: out.costUsd };
    persistExpandCache();
    return out;
  } catch {
    const heuristic = heuristicExpandQueries(q);
    return { queries: [q, ...heuristic].slice(0, 6), costUsd: 0 };
  }
}

/** Cheap keyword variants when the LLM fails or under-expands. */
function heuristicExpandQueries(q: string): string[] {
  const stop = new Set([
    "are",
    "there",
    "any",
    "is",
    "what",
    "how",
    "the",
    "a",
    "an",
    "on",
    "of",
    "for",
    "to",
    "in",
    "and",
    "or",
    "with",
    "using",
    "papers",
    "paper",
    "research",
    "methods",
    "method",
    "techniques",
    "technique",
  ]);
  const tokens = q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !stop.has(t));
  const keyword = tokens.slice(0, 10).join(" ");
  const out: string[] = [];
  if (keyword) out.push(keyword);

  // Classic NLP rephrase: avoid "large language model" drift toward 2023+ surveys.
  const classic = keyword
    .replace(/\blarge[-\s]?scale\b/g, "")
    .replace(/\blanguage\s+models?\b/g, "bert")
    .replace(/\s+/g, " ")
    .trim();
  if (classic && classic !== keyword) out.push(classic);

  if (
    /\bdistill/i.test(q) &&
    /\b(language model|bert|transformer)/i.test(q) &&
    !/\btinybert\b/i.test(q)
  ) {
    out.push("task-agnostic knowledge distillation BERT");
    out.push("TinyBERT Distilling BERT for Natural Language Understanding");
  }
  return out;
}

function paperEmbedText(p: Paper): string {
  const abs = (p.abstract ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return `${p.title}\n${abs}`.trim();
}

function paperEmbedCacheKey(p: Paper): string {
  const id =
    (p.doi && `doi:${p.doi}`) ||
    (p.arxivId && `arxiv:${p.arxivId}`) ||
    `t:${p.title.toLowerCase()}`;
  return createHash("sha256")
    .update(`${id}\n${paperEmbedText(p)}`)
    .digest("hex")
    .slice(0, 32);
}

/** Process-lifetime cache of candidate embeddings (shared across queries/stages). */
const docEmbedCache = new Map<string, Float32Array>();
const EMBED_BATCH = 32;

/** Serialize ONNX embed calls — concurrent worker access can abort the process. */
let embedChain: Promise<unknown> = Promise.resolve();
function withEmbedLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = embedChain.then(fn, fn);
  embedChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function embedDocsCached(
  papers: Paper[],
  signal?: AbortSignal,
): Promise<(Float32Array | null)[]> {
  const keys = papers.map(paperEmbedCacheKey);
  const missingIdx: number[] = [];
  const missingTexts: string[] = [];
  for (let i = 0; i < papers.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!docEmbedCache.has(keys[i]!)) {
      missingIdx.push(i);
      missingTexts.push(paperEmbedText(papers[i]!));
    }
  }
  if (missingTexts.length) {
    const embedder = await getEmbedder();
    for (let off = 0; off < missingTexts.length; off += EMBED_BATCH) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const batch = missingTexts.slice(off, off + EMBED_BATCH);
      const vecs = await embedder.embed(batch, { isQuery: false });
      for (let j = 0; j < batch.length; j++) {
        const vec = vecs[j];
        const pi = missingIdx[off + j]!;
        if (vec) docEmbedCache.set(keys[pi]!, vec);
      }
    }
  }
  return keys.map((k) => docEmbedCache.get(k) ?? null);
}

export async function semanticRerankPapers(input: {
  query: string;
  papers: Paper[];
  signal?: AbortSignal;
  /** Cap how many candidates we embed (rest keep RRF order after). Default 150. */
  topN?: number;
}): Promise<Paper[]> {
  if (input.papers.length <= 1) return input.papers;
  const topN = input.topN ?? RERANK_POOL_SIZE;
  const head = input.papers.slice(0, topN);
  const rest = input.papers.slice(topN);
  try {
    return await withEmbedLock(async () => {
      const embedder = await getEmbedder();
      const [qVec] = await embedder.embed([input.query], { isQuery: true });
      if (!qVec) return input.papers;
      const docVecs = await embedDocsCached(head, input.signal);
      const scored = head.map((p, i) => ({
        p,
        score: docVecs[i] ? cosine(qVec, docVecs[i]!) : 0,
      }));
      scored.sort((a, b) => b.score - a.score);
      return [...scored.map((s) => s.p), ...rest];
    });
  } catch {
    return input.papers;
  }
}

export async function citationHopExpand(input: {
  papers: Paper[];
  limitPerPaper?: number;
  signal?: AbortSignal;
}): Promise<Paper[]> {
  // Prefer papers with identifiers so OpenAlex/S2 hops can resolve.
  const withId = input.papers.filter((p) => p.doi || p.arxivId);
  const top = (withId.length ? withId : input.papers).slice(0, 5);
  const hopLimit = input.limitPerPaper ?? 12;
  const hops: Paper[][] = [];
  for (const p of top) {
    if (!p.doi && !p.arxivId) continue;
    try {
      const [refs, cites] = await Promise.all([
        hopLinks({
          doi: p.doi ?? undefined,
          arxivId: p.arxivId ?? undefined,
          direction: "references",
          limit: hopLimit,
          signal: input.signal,
        }),
        hopLinks({
          doi: p.doi ?? undefined,
          arxivId: p.arxivId ?? undefined,
          direction: "citations",
          limit: hopLimit,
          signal: input.signal,
        }),
      ]);
      hops.push(refs, cites);
    } catch {
      /* soft-fail per paper */
    }
  }
  if (!hops.length) return input.papers;
  const lists = [[...input.papers], ...hops.filter((h) => h.length > 0)];
  const ranked = rrfRank(lists);
  return ranked.length ? ranked : mergePapers(lists);
}

const llmScoresSchema = z.object({
  scores: z.array(
    z.object({
      i: z.number().int().nonnegative(),
      s: z.number().min(0).max(10),
    }),
  ),
});

export async function llmRerankPapers(input: {
  query: string;
  papers: Paper[];
  apiKey?: string | null;
  topN?: number;
  signal?: AbortSignal;
}): Promise<{ papers: Paper[]; costUsd: number }> {
  const topN = input.topN ?? LLM_RERANK_TOP_N;
  const slice = input.papers.slice(0, topN);
  if (slice.length <= 1 || !input.apiKey) {
    return { papers: input.papers, costUsd: 0 };
  }

  const catalog = slice.map((p, i) => ({
    i,
    title: p.title,
    year: p.year,
    abstract: (p.abstract ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
  }));

  try {
    // Use non-reasoning expand model (gpt) — gemini-flash burns tokens on reasoning.
    const openrouter = createOpenRouterClient(input.apiKey);
    const model = openrouter(paperExpandModel(), { usage: { include: true } });
    const result = await generateText({
      model,
      maxOutputTokens: 2048,
      temperature: 0,
      output: Output.object({ schema: llmScoresSchema }),
      system: `Score each paper 0–10 for relevance to the user question.
Return scores for EVERY paper index. Prefer the exact landmark paper when the question describes a well-known work.`,
      prompt: `Question:\n${input.query.slice(0, 1500)}\n\nPapers:\n${JSON.stringify(catalog)}`,
      abortSignal: input.signal,
    });
    const cost =
      (
        (await result.providerMetadata)?.openrouter as
          { usage?: { cost?: number } } | undefined
      )?.usage?.cost ?? 0;
    const scores = result.output?.scores ?? [];
    if (!scores.length) {
      return {
        papers: input.papers,
        costUsd: typeof cost === "number" ? cost : 0,
      };
    }
    const byIdx = new Map(scores.map((s) => [s.i, s.s]));
    const withScore = slice.map((p, i) => ({
      p,
      s: byIdx.get(i) ?? 0,
    }));
    withScore.sort((a, b) => b.s - a.s);
    const head = withScore.map((x) => x.p);
    const headKeys = new Set(
      head.map(
        (p) => (p.doi ?? "") || (p.arxivId ?? "") || p.title.toLowerCase(),
      ),
    );
    const rest = input.papers.filter((p) => {
      const k = (p.doi ?? "") || (p.arxivId ?? "") || p.title.toLowerCase();
      return !headKeys.has(k);
    });
    return {
      papers: [...head, ...rest],
      costUsd: typeof cost === "number" ? cost : 0,
    };
  } catch {
    return { papers: input.papers, costUsd: 0 };
  }
}

/** Apply post-pool enhancement (Qwen / hop / LLM). Pool growth happens in search. */
export async function enhanceRankedPapers(input: {
  query: string;
  ranked: Paper[];
  stage: SearchStage;
  apiKey?: string | null;
  signal?: AbortSignal;
}): Promise<{ papers: Paper[]; costUsd: number; stagesApplied: string[] }> {
  const stage = input.stage;
  const applied: string[] = [];
  let papers = input.ranked;
  let costUsd = 0;

  // Always cut to RRF top-150 before any local/LLM rerank (ranking addendum).
  if (papers.length > RERANK_POOL_SIZE) {
    papers = papers.slice(0, RERANK_POOL_SIZE);
  }

  const wantQwen =
    stage === "semantic" ||
    stage === "hop" ||
    stage === "llm" ||
    stage === "best";
  // Hop is opt-in only (too slow for the ≤20s shipped budget).
  const wantHop = stage === "hop";
  const wantLlm =
    stage === "llm" ||
    (stage === "best" && SHIPPED_SEARCH_STAGES.includes("llm"));

  if (wantQwen) {
    papers = await semanticRerankPapers({
      query: input.query,
      papers,
      topN: RERANK_POOL_SIZE,
      signal: input.signal,
    });
    applied.push("semantic");
  }

  if (wantHop) {
    papers = await citationHopExpand({
      papers,
      signal: input.signal,
    });
    papers = await semanticRerankPapers({
      query: input.query,
      papers,
      topN: RERANK_POOL_SIZE,
      signal: input.signal,
    });
    applied.push("hop");
  }

  if (wantLlm) {
    const r = await llmRerankPapers({
      query: input.query,
      papers,
      apiKey: input.apiKey,
      topN: LLM_RERANK_TOP_N,
      signal: input.signal,
    });
    papers = r.papers;
    costUsd += r.costUsd;
    applied.push("llm");
  }

  void paperEnhanceModel;
  return { papers, costUsd, stagesApplied: applied };
}
