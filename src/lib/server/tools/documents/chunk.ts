export type TextPage = { page: number; text: string };
export type ScoredChunk = { page?: number; text: string; score: number };

const TOKEN_RE = /[\p{L}\p{N}]+/gu;
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "is",
  "are",
  "for",
  "on",
  "with",
  "as",
  "by",
  "at",
  "be",
  "this",
  "that",
  "it",
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

/** Split text into roughly `maxChars` chunks on paragraph/sentence boundaries. */
export function splitIntoChunks(text: string, maxChars = 1200): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) out.push(current.trim());
    current = "";
  };
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      for (let i = 0; i < para.length; i += maxChars) {
        out.push(para.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (current && current.length + para.length + 2 > maxChars) flush();
    current += (current ? "\n\n" : "") + para;
  }
  flush();
  return out;
}

/**
 * Keyword TF-IDF-like scoring. Accepts per-page text or a single string and
 * returns the top chunks (with page numbers when pages are provided).
 */
export function scoreChunks(
  source: TextPage[] | string,
  query: string,
  opts?: { topK?: number; chunkChars?: number },
): ScoredChunk[] {
  const topK = opts?.topK ?? 5;
  const chunkChars = opts?.chunkChars ?? 1200;
  const pages: { page?: number; text: string }[] =
    typeof source === "string" ? [{ text: source }] : source;

  const chunks: { page?: number; text: string; tokens: string[] }[] = [];
  for (const p of pages) {
    for (const text of splitIntoChunks(p.text, chunkChars)) {
      chunks.push({ page: p.page, text, tokens: tokenize(text) });
    }
  }

  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !chunks.length) return [];

  const df = new Map<string, number>();
  for (const term of terms) {
    df.set(term, chunks.filter((c) => c.tokens.includes(term)).length);
  }

  const scored: ScoredChunk[] = [];
  for (const c of chunks) {
    const tf = new Map<string, number>();
    for (const t of c.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + chunks.length / (df.get(term) ?? 1));
      score += (1 + Math.log(f)) * idf;
    }
    if (score > 0) {
      scored.push({
        page: c.page,
        text: c.text,
        score: score / Math.sqrt(c.tokens.length || 1),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
