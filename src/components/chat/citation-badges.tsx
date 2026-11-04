"use client";

import * as React from "react";

import type { CitationSummary } from "@/lib/server/citations/types";

const STATUS_ICON: Record<string, string> = {
  verified: "✓",
  metadata_mismatch: "⚠",
  not_found: "✗",
  claim_not_supported: "✗",
  unchecked: "?",
};

export function CitationBadges({
  summary,
  summaryLine,
}: {
  summary: CitationSummary;
  summaryLine?: string;
}) {
  if (!summary.total) return null;
  return (
    <div
      className="text-muted-foreground mt-1 space-y-1 text-xs"
      data-testid="citation-badges"
    >
      <p data-testid="citation-summary">
        {summaryLine ??
          `${summary.total} citations · ${summary.verified} verified`}
      </p>
      <ul className="flex flex-wrap gap-1">
        {summary.results.map((r) => (
          <li key={r.citation.id}>
            <span
              className="border-border inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5"
              title={r.reason}
              data-testid="citation-badge"
              data-status={r.status}
            >
              <span aria-hidden>{STATUS_ICON[r.status] ?? "?"}</span>
              <span className="max-w-[12rem] truncate">
                {r.citation.doi ??
                  r.citation.arxivId ??
                  r.citation.title ??
                  r.citation.raw.slice(0, 40)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
