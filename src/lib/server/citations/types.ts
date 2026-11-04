import type { Paper } from "@/lib/server/tools/papers/types";

export type CitationKind = "doi" | "arxiv" | "url" | "free_text";

export type CitationStatus =
  | "verified"
  | "metadata_mismatch"
  | "not_found"
  | "claim_not_supported"
  | "unchecked";

export type SupportVerdict = "supported" | "not_supported" | "unclear";

export type ExtractedCitation = {
  id: string;
  kind: CitationKind;
  raw: string;
  /** Surrounding claim / sentence when available. */
  claim: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  title?: string;
  firstAuthor?: string;
  year?: number;
  /** Character offset in source text. */
  index: number;
};

export type CitationCheckResult = {
  citation: ExtractedCitation;
  status: CitationStatus;
  paper: Paper | null;
  titleSimilarity: number | null;
  yearOk: boolean | null;
  authorOk: boolean | null;
  support: SupportVerdict | null;
  reason: string;
};

export type CitationSummary = {
  total: number;
  verified: number;
  metadata_mismatch: number;
  not_found: number;
  claim_not_supported: number;
  unchecked: number;
  results: CitationCheckResult[];
};

export function emptySummary(results: CitationCheckResult[]): CitationSummary {
  const summary: CitationSummary = {
    total: results.length,
    verified: 0,
    metadata_mismatch: 0,
    not_found: 0,
    claim_not_supported: 0,
    unchecked: 0,
    results,
  };
  for (const r of results) {
    summary[r.status]++;
  }
  return summary;
}

export function formatCitationSummaryLine(s: CitationSummary): string {
  if (s.total === 0) return "0 citations";
  const bits = [`${s.total} citation${s.total === 1 ? "" : "s"}`];
  if (s.verified) bits.push(`${s.verified} verified`);
  if (s.metadata_mismatch) bits.push(`${s.metadata_mismatch} mismatch`);
  if (s.not_found) bits.push(`${s.not_found} not found`);
  if (s.claim_not_supported)
    bits.push(`${s.claim_not_supported} claim not supported`);
  if (s.unchecked) bits.push(`${s.unchecked} unchecked`);
  return bits.join(" · ");
}
