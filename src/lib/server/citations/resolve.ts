import "server-only";

import { searchCrossref } from "@/lib/server/tools/papers/providers/crossref";
import { getPaper, searchPapers } from "@/lib/server/tools/papers/search";
import type { Paper } from "@/lib/server/tools/papers/types";

import { titleSimilarity } from "./match";
import type { ExtractedCitation } from "./types";

export type ResolveOptions = {
  contactEmail?: string | null;
  signal?: AbortSignal;
  /** Injected resolver for offline evals / tests. */
  resolveOverride?: (
    c: ExtractedCitation,
  ) => Promise<Paper | null> | Paper | null;
};

/** Resolve a citation to a Paper via get_paper / search / Crossref. */
export async function resolveCitation(
  citation: ExtractedCitation,
  opts: ResolveOptions = {},
): Promise<Paper | null> {
  if (opts.resolveOverride) {
    return opts.resolveOverride(citation);
  }

  if (citation.doi || citation.arxivId) {
    const paper = await getPaper({
      doi: citation.doi,
      arxivId: citation.arxivId,
      contactEmail: opts.contactEmail,
      signal: opts.signal,
    });
    if (paper) return paper;
  }

  if (citation.url && (citation.doi || citation.arxivId)) {
    const paper = await getPaper({
      doi: citation.doi,
      arxivId: citation.arxivId,
      contactEmail: opts.contactEmail,
      signal: opts.signal,
    });
    if (paper) return paper;
  }

  if (citation.title) {
    const q = [citation.title, citation.firstAuthor, citation.year]
      .filter(Boolean)
      .join(" ");
    const { papers } = await searchPapers({
      query: q,
      limit: 5,
      contactEmail: opts.contactEmail,
      signal: opts.signal,
      enabledProviders: ["crossref", "openalex", "semantic_scholar", "arxiv"],
    });
    const ranked = papers
      .map((p) => ({
        p,
        sim: titleSimilarity(citation.title!, p.title),
      }))
      .sort((a, b) => b.sim - a.sim);
    if (ranked[0] && ranked[0].sim >= 0.7) return ranked[0].p;

    // Direct Crossref bibliographic query as a last try.
    const cr = await searchCrossref(q, {
      limit: 3,
      signal: opts.signal,
      mailto: opts.contactEmail ?? undefined,
    });
    const best = cr.papers
      .map((p) => ({ p, sim: titleSimilarity(citation.title!, p.title) }))
      .sort((a, b) => b.sim - a.sim)[0];
    if (best && best.sim >= 0.7) return best.p;
  }

  return null;
}
