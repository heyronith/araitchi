import "server-only";

import { extractCitations } from "./extract";
import { metadataMatches } from "./match";
import { resolveCitation, type ResolveOptions } from "./resolve";
import { checkClaimSupportDetailed, type SupportCheckOptions } from "./support";
import {
  emptySummary,
  type CitationCheckResult,
  type CitationSummary,
} from "./types";

export type CheckCitationsOptions = ResolveOptions &
  SupportCheckOptions & {
    /** Skip abstract support check (existence + metadata only). */
    skipSupport?: boolean;
  };

export async function checkCitations(
  text: string,
  opts: CheckCitationsOptions = {},
): Promise<CitationSummary> {
  const extracted = extractCitations(text);
  const results: CitationCheckResult[] = [];

  for (const citation of extracted) {
    let paper = null;
    try {
      paper = await resolveCitation(citation, opts);
    } catch {
      paper = null;
    }

    if (!paper) {
      results.push({
        citation,
        status: "not_found",
        paper: null,
        titleSimilarity: null,
        yearOk: null,
        authorOk: null,
        support: null,
        reason: "Could not resolve citation in Crossref/arXiv/OpenAlex/S2",
      });
      continue;
    }

    const meta = metadataMatches(citation, paper);
    if (!meta.ok) {
      results.push({
        citation,
        status: "metadata_mismatch",
        paper,
        titleSimilarity: meta.titleSimilarity,
        yearOk: meta.yearOk,
        authorOk: meta.authorOk,
        support: null,
        reason: "Resolved paper metadata does not match the citation",
      });
      continue;
    }

    if (opts.skipSupport || !paper.abstract) {
      results.push({
        citation,
        status: "verified",
        paper,
        titleSimilarity: meta.titleSimilarity,
        yearOk: meta.yearOk,
        authorOk: meta.authorOk,
        support: null,
        reason: paper.abstract
          ? "Metadata matches (support skipped)"
          : "Exists; metadata OK; abstract unavailable for support check",
      });
      continue;
    }

    const support = await checkClaimSupportDetailed(
      citation.claim,
      paper,
      opts,
    );
    if (support.verdict === "not_supported") {
      results.push({
        citation,
        status: "claim_not_supported",
        paper,
        titleSimilarity: meta.titleSimilarity,
        yearOk: meta.yearOk,
        authorOk: meta.authorOk,
        support: support.verdict,
        reason: support.reason,
      });
      continue;
    }

    results.push({
      citation,
      status: "verified",
      paper,
      titleSimilarity: meta.titleSimilarity,
      yearOk: meta.yearOk,
      authorOk: meta.authorOk,
      support: support.verdict,
      reason:
        support.verdict === "supported"
          ? support.reason
          : `Exists and metadata matches; support ${support.verdict}`,
    });
  }

  return emptySummary(results);
}

/** Format member citation statuses for the synthesizer prompt. */
export function formatMemberCitationBrief(
  memberLabel: string,
  summary: CitationSummary,
): string {
  if (summary.total === 0) {
    return `${memberLabel}: no citations detected.`;
  }
  const lines = summary.results.map((r) => {
    const id =
      r.citation.doi ??
      r.citation.arxivId ??
      r.citation.title ??
      r.citation.raw.slice(0, 60);
    return `  - [${r.status}] ${id}${r.reason ? ` — ${r.reason}` : ""}`;
  });
  return [
    `${memberLabel}: ${summary.total} citations (${summary.verified} verified, ${summary.not_found} not found, ${summary.metadata_mismatch} mismatch, ${summary.claim_not_supported} unsupported).`,
    "Do not rely on not_found or metadata_mismatch citations; treat those as weaknesses of this member's answer.",
    ...lines,
  ].join("\n");
}

/** True if a record's only cited support is failed citations. */
export function citationsBlockMemorySave(summary: CitationSummary): boolean {
  if (summary.total === 0) return false;
  const failed = summary.results.filter(
    (r) =>
      r.status === "not_found" ||
      r.status === "metadata_mismatch" ||
      r.status === "claim_not_supported",
  );
  const ok = summary.results.filter((r) => r.status === "verified");
  return failed.length > 0 && ok.length === 0;
}

export function citationIsVerifiedSaveable(
  summary: CitationSummary,
  doi?: string | null,
  arxivId?: string | null,
): boolean {
  const hit = summary.results.find(
    (r) =>
      (doi && r.citation.doi === doi) ||
      (arxivId && r.citation.arxivId === arxivId) ||
      (doi && r.paper?.doi === doi) ||
      (arxivId && r.paper?.arxivId === arxivId),
  );
  if (hit) return hit.status === "verified";
  return false;
}
