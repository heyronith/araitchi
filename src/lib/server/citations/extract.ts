import "server-only";

import { nanoid } from "nanoid";

import {
  normalizeArxivId,
  normalizeDoi,
} from "@/lib/server/tools/papers/merge";

import type { ExtractedCitation } from "./types";

const DOI_RE = /\b(?:doi:\s*)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/gi;
const ARXIV_RE = /\b(?:arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?\b/gi;
const ARXIV_OLD_RE =
  /\b(?:arxiv:\s*)?((?:cs|math|physics|q-bio|q-fin|stat|hep|gr-qc|nlin|nucl|astro-ph|cond-mat)(?:\.[A-Za-z-]+)?\/\d{7})\b/gi;
const URL_RE = /https?:\/\/[^\s\]\)>"']+/gi;

/** Author et al., Year — Title  OR  Title (Author, Year) */
const FREE_TEXT_RE =
  /(?:^|[.!?]\s+)([A-Z][\w'’-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][\w'’-]+))?)\s*[,(]\s*((?:19|20)\d{2})\s*[),]?\s*[,:]?\s*[“"']?([^“"'.\n]{12,160})/g;

function sentenceAround(text: string, index: number, len: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1);
  let end = text.indexOf(".", index + len);
  if (end < 0) end = text.length;
  return text.slice(start, end + 1).trim();
}

function pushUnique(
  out: ExtractedCitation[],
  c: Omit<ExtractedCitation, "id">,
) {
  const key = [
    c.kind,
    c.doi ?? "",
    c.arxivId ?? "",
    c.url ?? "",
    (c.title ?? "").toLowerCase(),
  ].join("|");
  if (
    out.some(
      (x) =>
        [
          x.kind,
          x.doi ?? "",
          x.arxivId ?? "",
          x.url ?? "",
          (x.title ?? "").toLowerCase(),
        ].join("|") === key,
    )
  ) {
    return;
  }
  out.push({ ...c, id: nanoid(8) });
}

/** Extract DOIs, arXiv ids, paper URLs, and free-text author/year/title cites. */
export function extractCitations(text: string): ExtractedCitation[] {
  const out: ExtractedCitation[] = [];
  if (!text?.trim()) return out;

  for (const m of text.matchAll(DOI_RE)) {
    const raw = m[0]!;
    const doi = normalizeDoi(m[1] ?? raw);
    if (!doi) continue;
    const index = m.index ?? 0;
    pushUnique(out, {
      kind: "doi",
      raw,
      doi,
      claim: sentenceAround(text, index, raw.length),
      index,
    });
  }

  for (const re of [ARXIV_RE, ARXIV_OLD_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const raw = m[0]!;
      const arxivId = normalizeArxivId(m[1] ?? raw);
      if (!arxivId) continue;
      const index = m.index ?? 0;
      pushUnique(out, {
        kind: "arxiv",
        raw,
        arxivId,
        claim: sentenceAround(text, index, raw.length),
        index,
      });
    }
  }

  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0]!.replace(/[),.;]+$/, "");
    const lower = raw.toLowerCase();
    const academic =
      /(doi\.org|arxiv\.org|semanticscholar|openalex|pubmed|nature\.com|science\.org|acm\.org|ieee\.org|openreview\.net)/i.test(
        lower,
      ) || /\.pdf(\?|$)/i.test(lower);
    if (!academic) continue;
    const index = m.index ?? 0;
    const doiFromUrl = normalizeDoi(raw);
    const arxivFromUrl = normalizeArxivId(raw);
    pushUnique(out, {
      kind: "url",
      raw,
      url: raw,
      doi: doiFromUrl ?? undefined,
      arxivId: arxivFromUrl ?? undefined,
      claim: sentenceAround(text, index, raw.length),
      index,
    });
  }

  FREE_TEXT_RE.lastIndex = 0;
  for (const m of text.matchAll(FREE_TEXT_RE)) {
    const firstAuthor = m[1]!.replace(/\s+et\s+al\.?/i, "").trim();
    const year = Number(m[2]);
    const title = m[3]!.trim().replace(/[“”"']$/g, "");
    if (!title || Number.isNaN(year)) continue;
    const raw = m[0]!.trim();
    const index = m.index ?? 0;
    pushUnique(out, {
      kind: "free_text",
      raw,
      title,
      firstAuthor,
      year,
      claim: sentenceAround(text, index, raw.length),
      index,
    });
  }

  // Attach asserted title/year/author from the surrounding claim onto id cites
  // so "wrong title (doi:…)" becomes a metadata_mismatch, not a bare existence check.
  for (const c of out) {
    if (c.kind !== "doi" && c.kind !== "arxiv" && c.kind !== "url") continue;
    enrichFromClaim(c);
  }

  return out.sort((a, b) => a.index - b.index);
}

/** Pull quoted title / author / year from the claim sentence onto an id citation. */
export function enrichFromClaim(c: ExtractedCitation): void {
  const claim = c.claim;
  if (!c.year) {
    const ym = claim.match(/\b((?:19|20)\d{2})\b/);
    if (ym) c.year = Number(ym[1]);
  }
  if (!c.title) {
    const qm = claim.match(/[“"']([^“"']{12,160})[”"']/);
    if (qm) c.title = qm[1]!.trim();
  }
  if (!c.firstAuthor) {
    const am = claim.match(
      /\b([A-Z][\w'’-]+)(?:\s+et\s+al\.?|\s*[,(]\s*(?:19|20)\d{2})/,
    );
    if (am) c.firstAuthor = am[1]!;
  }
}
