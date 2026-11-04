import "server-only";

import type { ToolBroker } from "@/lib/server/tools/broker";
import { createBrokerForRequest } from "@/lib/server/tools/broker";
import { createPaperTools } from "@/lib/server/tools/papers/tools";
import type { Paper, PaperProvider } from "@/lib/server/tools/papers/types";

import { titleSimilarity } from "./match";
import {
  classifyMiss,
  type ProviderLookupAttempt,
  type ResolveOutcome,
} from "./resolve-outcome";
import type { ExtractedCitation } from "./types";

export type ResolveOptions = {
  contactEmail?: string | null;
  signal?: AbortSignal;
  projectPath?: string;
  /** Prefer injecting a broker so cache / rate limits / inflight dedupe apply. */
  broker?: ToolBroker;
  /** Restrict search providers (e.g. offline Crossref+arXiv only). */
  enabledProviders?: PaperProvider[];
  /**
   * Injected resolver for offline evals / tests.
   * May return a Paper, null (treated as not_found when override decides),
   * or a full ResolveCitationResult.
   */
  resolveOverride?: (
    c: ExtractedCitation,
  ) =>
    | Promise<Paper | null | ResolveCitationResult>
    | Paper
    | null
    | ResolveCitationResult;
};

export type ResolveCitationResult = {
  paper: Paper | null;
  outcome: ResolveOutcome;
};

function paperFromBrokerData(data: unknown): Paper | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { paper?: Paper; papers?: Paper[] };
  if (d.paper?.title) return d.paper;
  if (Array.isArray(d.papers) && d.papers[0]?.title) return d.papers[0]!;
  return null;
}

function attemptsFromBrokerData(data: unknown): ProviderLookupAttempt[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { attempts?: ProviderLookupAttempt[] };
  return Array.isArray(d.attempts) ? d.attempts : [];
}

function ensurePapersBroker(opts: ResolveOptions): ToolBroker {
  if (opts.broker) return opts.broker;
  if (!opts.projectPath) {
    throw new Error(
      "resolveCitation requires projectPath or broker (for tool-broker cache)",
    );
  }
  const broker = createBrokerForRequest({
    projectPath: opts.projectPath,
    chatId: "citation-check",
    messageId: "citation-check",
    // Paper providers (esp. OpenAlex/S2) can exceed the default 30s tool timeout.
    timeoutMs: 120_000,
  });
  broker.registerAll(
    createPaperTools({
      contactEmail: opts.contactEmail ?? undefined,
      projectPath: opts.projectPath,
      enabledProviders: opts.enabledProviders,
    }),
  );
  return broker;
}

function foundResult(
  paper: Paper,
  attempts: ProviderLookupAttempt[] = [],
): ResolveCitationResult {
  return {
    paper,
    outcome: {
      kind: "found",
      reason: "Resolved via paper providers",
      attempts,
    },
  };
}

/**
 * Resolve a citation through the tool broker (`get_paper` / `search_papers`)
 * so cache, rate limits, in-flight dedupe, and OpenAlex budget modes apply.
 *
 * Distinguishes confident `not_found` (≥2 providers answered) from
 * `unchecked` (429 / 5xx / timeout / budget / all providers erroring).
 */
export async function resolveCitationDetailed(
  citation: ExtractedCitation,
  opts: ResolveOptions = {},
): Promise<ResolveCitationResult> {
  if (opts.resolveOverride) {
    const out = await opts.resolveOverride(citation);
    if (out && typeof out === "object" && "outcome" in out) {
      return out;
    }
    if (out && typeof out === "object" && "title" in out) {
      return foundResult(out);
    }
    return {
      paper: null,
      outcome: {
        kind: "not_found",
        reason: "Override resolver returned null",
        attempts: [],
      },
    };
  }

  const broker = ensurePapersBroker(opts);
  const modelId = "citation-check";
  let attempts: ProviderLookupAttempt[] = [];

  if (citation.doi || citation.arxivId) {
    const result = await broker.call(
      "get_paper",
      {
        doi: citation.doi,
        arxivId: citation.arxivId,
      },
      { modelId, signal: opts.signal },
    );
    attempts = attemptsFromBrokerData(result.data);
    if (result.ok) {
      const paper = paperFromBrokerData(result.data);
      if (paper) return foundResult(paper, attempts);
    } else if (attempts.length === 0) {
      // Broker/tool failure before provider attempts (timeout, throw, etc.).
      const err = result.error ?? "get_paper failed";
      return {
        paper: null,
        outcome: {
          kind: "unchecked",
          reason: `Inconclusive resolution: ${err}`,
          attempts: [],
        },
      };
    } else {
      // Providers ran; none found a paper — classify miss vs unchecked.
      return { paper: null, outcome: classifyMiss(attempts) };
    }
  }

  if (citation.title) {
    const q = [citation.title, citation.firstAuthor, citation.year]
      .filter(Boolean)
      .join(" ");
    const result = await broker.call(
      "search_papers",
      { query: q, limit: 5 },
      { modelId, signal: opts.signal },
    );
    if (result.ok) {
      const data = result.data as {
        papers?: Paper[];
        providers?: { provider: PaperProvider; ok: boolean; error?: string }[];
      } | null;
      const papers = data?.papers ?? [];
      const ranked = papers
        .map((p) => ({
          p,
          sim: titleSimilarity(citation.title!, p.title),
        }))
        .sort((a, b) => b.sim - a.sim);
      if (ranked[0] && ranked[0].sim >= 0.7) {
        return foundResult(ranked[0].p, attempts);
      }
      const searchAttempts: ProviderLookupAttempt[] = (
        data?.providers ?? []
      ).map((p) => ({
        provider: p.provider,
        answered: p.ok,
        error: p.ok ? undefined : (p.error ?? "error"),
      }));
      const combined = [...attempts, ...searchAttempts];
      if (combined.length >= 2) {
        return { paper: null, outcome: classifyMiss(combined) };
      }
      if (searchAttempts.length > 0) {
        return { paper: null, outcome: classifyMiss(searchAttempts) };
      }
    } else {
      const err = result.error ?? "search_papers failed";
      return {
        paper: null,
        outcome: classifyMiss([
          ...attempts,
          { provider: "crossref", answered: false, error: err },
        ]),
      };
    }
  }

  if (attempts.length > 0) {
    return { paper: null, outcome: classifyMiss(attempts) };
  }
  return {
    paper: null,
    outcome: {
      kind: "unchecked",
      reason: "No providers queried",
      attempts: [],
    },
  };
}

/** Convenience wrapper — paper only (loses unchecked vs not_found). */
export async function resolveCitation(
  citation: ExtractedCitation,
  opts: ResolveOptions = {},
): Promise<Paper | null> {
  return (await resolveCitationDetailed(citation, opts)).paper;
}
