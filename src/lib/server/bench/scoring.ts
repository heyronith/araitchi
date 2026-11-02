import type { Embedder } from "@/lib/server/memory/types";
import { cosine } from "@/lib/server/memory/vector";
import type { ToolSource } from "@/lib/server/tools/types";

import {
  checkDate,
  checkDoi,
  checkExactEntity,
  checkNumeric,
  extractDoisAndArxiv,
  normalizeArxiv,
  normalizeDoi,
  precisionOfCitations,
  recallAtK,
  rediscoveryHit,
} from "./checkers";
import type { BenchSetId } from "./runner-types";

export function scoreVerifiable(
  item: Record<string, unknown>,
  text: string,
): boolean {
  const checker = item.checker as string;
  if (checker === "numeric") {
    return checkNumeric(
      text,
      item.expected as number,
      (item.tolerance as number) ?? 0,
    );
  }
  if (checker === "doi") return checkDoi(text, item.expected as string);
  if (checker === "exact")
    return checkExactEntity(text, item.expected as string);
  if (checker === "date") return checkDate(text, item.expected as string);
  return false;
}

/** Prefer tool provenance DOIs/arXiv; fall back to regex on reply text. */
export function paperIdsFromProvenance(
  sources: ToolSource[] | undefined,
  text: string,
): string[] {
  const out = new Set<string>();
  for (const s of sources ?? []) {
    if (s.doi) out.add(normalizeDoi(s.doi));
    if (s.arxivId) out.add(normalizeArxiv(s.arxivId));
    if (s.url) {
      for (const id of extractDoisAndArxiv(s.url)) out.add(id);
    }
  }
  for (const id of extractDoisAndArxiv(text)) out.add(id);
  return [...out];
}

export async function scoreLiterature(input: {
  item: Record<string, unknown>;
  text: string;
  sources?: ToolSource[];
  resolveIds?: (ids: string[]) => Promise<Set<string>>;
}): Promise<{
  correct: boolean;
  score: number;
  detail: string;
  predicted: string[];
}> {
  const predicted = paperIdsFromProvenance(input.sources, input.text);
  const gold = ((input.item.goldDois as string[]) ?? []).map((g) =>
    g.includes("/") && g.startsWith("10.")
      ? normalizeDoi(g)
      : normalizeArxiv(g),
  );
  const r = recallAtK(predicted, gold, 20);
  let resolvable = new Set(
    ((input.item.resolvable as string[]) ?? gold).map((x) =>
      x.includes("/") && x.startsWith("10.")
        ? normalizeDoi(x)
        : normalizeArxiv(x),
    ),
  );
  if (input.resolveIds) {
    resolvable = await input.resolveIds(predicted);
  }
  const p = precisionOfCitations(predicted, resolvable);
  return {
    score: r,
    correct: r >= 0.5 && p >= 0.5,
    detail: `recall@20=${r.toFixed(2)} precision=${p.toFixed(2)} nPred=${predicted.length}`,
    predicted,
  };
}

/** Parse top hypotheses from hypothesis_generation-style output. */
export function parseTopHypotheses(text: string, max = 3): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines
    .filter((l) => /^[-*•]|\d+[.)]/.test(l))
    .map((l) => l.replace(/^[-*•]\s*|\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 20);
  if (bullets.length) return bullets.slice(0, max);
  // Fallback: first max paragraphs / sentences chunks
  const paras = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20);
  if (paras.length >= 2) return paras.slice(0, max);
  return [text.trim()].filter(Boolean).slice(0, max);
}

export async function scoreRediscovery(input: {
  item: Record<string, unknown>;
  text: string;
  hypotheses?: string[];
  embedder: Embedder;
  similarityThreshold: number;
}): Promise<{
  correct: boolean;
  score: number;
  borderline: boolean;
  detail: string;
  excludedFromHeadline: boolean;
}> {
  const verified = input.item.verified === true;
  const hyps = input.hypotheses?.length
    ? input.hypotheses.slice(0, 3)
    : parseTopHypotheses(input.text, 3);
  const gold = String(input.item.goldStatement ?? "");
  const joined = hyps.join("\n") || input.text;
  const [hVec, gVec] = await input.embedder.embed([joined, gold], {
    isQuery: false,
  });
  const sim = cosine(hVec!, gVec!);
  const rd = rediscoveryHit({
    hypotheses: hyps.length ? hyps : [input.text],
    requiredTerms: (input.item.requiredTerms as string[]) ?? [],
    goldStatement: gold,
    similarity: sim,
    similarityThreshold: input.similarityThreshold,
  });
  return {
    correct: rd.hit,
    score: rd.hit ? 1 : 0,
    borderline: rd.borderline,
    detail: `termScore=${rd.termScore.toFixed(2)} sim=${sim.toFixed(2)} verified=${verified}`,
    excludedFromHeadline: !verified,
  };
}

export function parseStatedVerdict(text: string): string | null {
  const m = text.match(/\b(supported|refuted|inconclusive|replicated)\b/i);
  return m ? m[1]!.toLowerCase() : null;
}

export function scoreSet(
  set: BenchSetId,
  item: Record<string, unknown>,
  payload: {
    text: string;
    sources?: ToolSource[];
    hypotheses?: string[];
    verdict?: string | null;
  },
): { correct: boolean; score: number; detail: string } | null {
  if (set === "1") {
    const correct = scoreVerifiable(item, payload.text);
    return { correct, score: correct ? 1 : 0, detail: "" };
  }
  if (set === "4" && payload.verdict != null) {
    const expected = String(item.expectedVerdict);
    const correct = payload.verdict === expected;
    return {
      correct,
      score: correct ? 1 : 0,
      detail: `verdict=${payload.verdict} expected=${expected}`,
    };
  }
  return null;
}
