import type { PaperProvider } from "@/lib/server/tools/papers/types";

/** One provider's answer when resolving a citation by id. */
export type ProviderLookupAttempt = {
  provider: PaperProvider;
  /**
   * True when the provider gave a definitive answer (found the work, or a
   * clean miss such as HTTP 404). False for 429 / 5xx / timeout / budget /
   * network errors — those are inconclusive.
   */
  answered: boolean;
  error?: string;
};

export type ResolveOutcomeKind = "found" | "not_found" | "unchecked";

export type ResolveOutcome = {
  kind: ResolveOutcomeKind;
  reason: string;
  attempts: ProviderLookupAttempt[];
};

const INCONCLUSIVE_RE =
  /rate_limited|429|timeout|timed out|aborted|budget|exhausted|HTTP 5\d\d|fetch failed|econn|enotfound|network|socket|unreachable|503|502|500|408/i;

/** True when an error string means we cannot trust a miss. */
export function isInconclusiveProviderError(
  error: string | undefined,
): boolean {
  if (!error?.trim()) return false;
  return INCONCLUSIVE_RE.test(error);
}

/**
 * Classify a set of provider attempts after none produced a paper.
 * `not_found` only when ≥2 providers answered successfully; otherwise
 * `unchecked` (429 / 5xx / timeout / budget / all failing).
 */
export function classifyMiss(
  attempts: ProviderLookupAttempt[],
): ResolveOutcome {
  const answered = attempts.filter((a) => a.answered);
  const failed = attempts.filter((a) => !a.answered);
  if (answered.length >= 2) {
    return {
      kind: "not_found",
      reason: `${answered.length} providers answered; none found the work`,
      attempts,
    };
  }
  const failBits = failed
    .map((a) => `${a.provider}:${a.error ?? "error"}`)
    .slice(0, 4);
  const reason =
    failed.length > 0
      ? `Inconclusive resolution (${answered.length} definitive answers): ${failBits.join("; ")}`
      : `Inconclusive resolution: only ${answered.length} provider answer(s)`;
  return { kind: "unchecked", reason, attempts };
}
