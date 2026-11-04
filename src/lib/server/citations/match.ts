import "server-only";

import { normalizeTitle } from "@/lib/server/tools/papers/merge";
import type { Paper } from "@/lib/server/tools/papers/types";

import type { ExtractedCitation } from "./types";

/** Bigram Dice coefficient on normalised titles. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    if (s.length < 2) {
      m.set(s, 1);
      return m;
    }
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  for (const [g, c] of A) {
    inter += Math.min(c, B.get(g) ?? 0);
  }
  const total =
    [...A.values()].reduce((s, n) => s + n, 0) +
    [...B.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  return (2 * inter) / total;
}

export function yearMatches(
  claimed: number | undefined,
  paperYear: number | null,
): boolean | null {
  if (claimed == null || paperYear == null) return null;
  return Math.abs(claimed - paperYear) <= 1;
}

export function firstAuthorMatches(
  claimed: string | undefined,
  authors: string[],
): boolean | null {
  if (!claimed?.trim() || !authors.length) return null;
  const want = claimed
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .trim()
    .split(/\s+/)
    .pop();
  if (!want) return null;
  const first = authors[0]!.toLowerCase();
  return first.includes(want) || want.includes(first.split(/\s+/).pop() ?? "");
}

export const TITLE_MATCH_THRESHOLD = 0.85;

/**
 * Metadata match when the citation asserts title/year/author
 * (or when we compare a resolved paper against free-text fields).
 */
export function metadataMatches(
  citation: ExtractedCitation,
  paper: Paper,
): {
  ok: boolean;
  titleSimilarity: number | null;
  yearOk: boolean | null;
  authorOk: boolean | null;
} {
  let titleSim: number | null = null;
  let yearOk: boolean | null = null;
  let authorOk: boolean | null = null;
  let checked = false;

  if (citation.title) {
    titleSim = titleSimilarity(citation.title, paper.title);
    checked = true;
    if (titleSim < TITLE_MATCH_THRESHOLD) {
      return { ok: false, titleSimilarity: titleSim, yearOk, authorOk };
    }
  }
  if (citation.year != null) {
    yearOk = yearMatches(citation.year, paper.year);
    checked = true;
    if (yearOk === false) {
      return { ok: false, titleSimilarity: titleSim, yearOk, authorOk };
    }
  }
  if (citation.firstAuthor) {
    authorOk = firstAuthorMatches(citation.firstAuthor, paper.authors);
    checked = true;
    if (authorOk === false) {
      return { ok: false, titleSimilarity: titleSim, yearOk, authorOk };
    }
  }

  // DOI/arXiv-only cites: existence is enough for metadata (no conflicting fields).
  if (!checked) {
    return { ok: true, titleSimilarity: titleSim, yearOk, authorOk };
  }
  return { ok: true, titleSimilarity: titleSim, yearOk, authorOk };
}
