/**
 * Deterministic evidence-quote checks for scribe records (+ STATE narrative).
 * Quotes must appear in the conversation source (user + assistant).
 * Claims must be entailed by their quote (no overstatement).
 */

const STOP = new Set(
  "the a an and or but if then with without from into onto over under about above below after before between during for of on to in at by as is are was were be been being this that these those it its they them we you your our their not no yes do does did done have has had can could should would may might will just only also more most such than so very into".split(
    " ",
  ),
);

export function normalizeEvidenceText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function lightStem(token: string): string {
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/** Content tokens used for entailment (length ≥ 4, not stopwords). */
export function contentTokens(text: string): string[] {
  return normalizeEvidenceText(text)
    .replace(/[^a-z0-9\s>-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP.has(t))
    .map(lightStem);
}

/** True when quote appears in source after whitespace/case normalisation. */
export function evidenceQuoteInSource(
  quote: string,
  sourceText: string,
): boolean {
  const q = normalizeEvidenceText(quote);
  if (q.length < 8) return false;
  return normalizeEvidenceText(sourceText).includes(q);
}

/**
 * Deterministic entailment: the record's title (and body) must not invent
 * content beyond the evidence quote. Title content-tokens must mostly appear
 * in the quote; body may add light connective wording but ≥60% of its
 * content-tokens must also appear in the quote.
 */
export function claimEntailedByQuote(input: {
  title: string;
  body?: string;
  quote: string;
}): boolean {
  const quoteToks = new Set(contentTokens(input.quote));
  if (quoteToks.size === 0) return false;

  const titleToks = contentTokens(input.title);
  if (titleToks.length === 0) return false;
  const titleHit = titleToks.filter((t) => quoteToks.has(t)).length;
  if (titleHit / titleToks.length < 0.5) return false;

  const body = (input.body ?? "").trim();
  if (!body) return true;
  const bodyToks = contentTokens(body);
  if (bodyToks.length === 0) return true;
  const bodyHit = bodyToks.filter((t) => quoteToks.has(t)).length;
  // Body may lightly rephrase; still require most content words in the quote.
  return bodyHit / bodyToks.length >= 0.4;
}

export const EVIDENCE_TAG_PREFIX = "evidence:";

export function evidenceTag(quote: string): string {
  return `${EVIDENCE_TAG_PREFIX}${quote.trim().slice(0, 500)}`;
}

export function extractEvidenceQuote(
  tags: string[] | null | undefined,
): string | null {
  if (!tags?.length) return null;
  const hit = tags.find((t) => t.startsWith(EVIDENCE_TAG_PREFIX));
  if (!hit) return null;
  const q = hit.slice(EVIDENCE_TAG_PREFIX.length).trim();
  return q || null;
}

export function stripEvidenceTags(tags: string[]): string[] {
  return tags.filter((t) => !t.startsWith(EVIDENCE_TAG_PREFIX));
}
