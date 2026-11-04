import "server-only";

import type { ToolBroker } from "@/lib/server/tools/broker";
import { createBrokerForRequest } from "@/lib/server/tools/broker";
import { createPaperTools } from "@/lib/server/tools/papers/tools";
import type { Paper, PaperProvider } from "@/lib/server/tools/papers/types";

import { titleSimilarity } from "./match";
import type { ExtractedCitation } from "./types";

export type ResolveOptions = {
  contactEmail?: string | null;
  signal?: AbortSignal;
  projectPath?: string;
  /** Prefer injecting a broker so cache / rate limits / inflight dedupe apply. */
  broker?: ToolBroker;
  /** Restrict search providers (e.g. offline Crossref+arXiv only). */
  enabledProviders?: PaperProvider[];
  /** Injected resolver for offline evals / tests. */
  resolveOverride?: (
    c: ExtractedCitation,
  ) => Promise<Paper | null> | Paper | null;
};

function paperFromBrokerData(data: unknown): Paper | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { paper?: Paper; papers?: Paper[] };
  if (d.paper?.title) return d.paper;
  if (Array.isArray(d.papers) && d.papers[0]?.title) return d.papers[0]!;
  return null;
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

/**
 * Resolve a citation through the tool broker (`get_paper` / `search_papers`)
 * so cache, rate limits, in-flight dedupe, and OpenAlex budget modes apply.
 */
export async function resolveCitation(
  citation: ExtractedCitation,
  opts: ResolveOptions = {},
): Promise<Paper | null> {
  if (opts.resolveOverride) {
    return opts.resolveOverride(citation);
  }

  const broker = ensurePapersBroker(opts);
  const modelId = "citation-check";

  if (citation.doi || citation.arxivId) {
    const result = await broker.call(
      "get_paper",
      {
        doi: citation.doi,
        arxivId: citation.arxivId,
      },
      { modelId, signal: opts.signal },
    );
    if (result.ok) {
      const paper = paperFromBrokerData(result.data);
      if (paper) return paper;
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
      const data = result.data as { papers?: Paper[] } | null;
      const papers = data?.papers ?? [];
      const ranked = papers
        .map((p) => ({
          p,
          sim: titleSimilarity(citation.title!, p.title),
        }))
        .sort((a, b) => b.sim - a.sim);
      if (ranked[0] && ranked[0].sim >= 0.7) return ranked[0].p;
    }
  }

  return null;
}
