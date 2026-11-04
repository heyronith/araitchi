import "server-only";

import type { Paper } from "@/lib/server/tools/papers/types";

import { titleSimilarity } from "./match";
import type { SupportVerdict } from "./types";

export type SupportCheckOptions = {
  /**
   * Live: call a cheap model. Offline/tests: omit and use heuristic.
   */
  checkWithModel?: (input: {
    claim: string;
    abstract: string;
    title: string;
  }) => Promise<SupportVerdict>;
};

/**
 * When an abstract is available, decide if the claim is consistent with it.
 * Default heuristic: token overlap / title-ish similarity on claim vs abstract.
 */
export async function checkClaimSupport(
  claim: string,
  paper: Paper,
  opts: SupportCheckOptions = {},
): Promise<SupportVerdict> {
  const abstract = paper.abstract?.trim();
  if (!abstract) return "unclear";
  const c = claim.trim();
  if (!c) return "unclear";

  if (opts.checkWithModel) {
    return opts.checkWithModel({
      claim: c,
      abstract,
      title: paper.title,
    });
  }

  // Heuristic: if claim shares little with abstract AND asserts a specific
  // quantitative/causal claim that doesn't appear → not_supported; else unclear/supported.
  const sim = titleSimilarity(c.slice(0, 200), abstract.slice(0, 800));
  const claimTokens = new Set(
    c
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
  const absLower = abstract.toLowerCase();
  let hits = 0;
  for (const t of claimTokens) {
    if (absLower.includes(t)) hits++;
  }
  const ratio = claimTokens.size ? hits / claimTokens.size : 0;

  if (ratio >= 0.35 || sim >= 0.25) return "supported";
  if (ratio < 0.12 && sim < 0.1 && claimTokens.size >= 6) {
    return "not_supported";
  }
  return "unclear";
}
