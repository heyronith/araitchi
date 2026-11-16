import "server-only";

import { getProviderBaseUrl } from "../env";
import { normalizeArxivId } from "../merge";
import type { Paper, ProviderSearchResult } from "../types";
import { fetchText } from "./http";
import {
  arxivIdFromUrl,
  clampLimit,
  cleanText,
  decodeEntities,
  makePaper,
  runProvider,
  userAgent,
  yearFromDate,
  type ProviderSearchOpts,
} from "./util";

function tagText(chunk: string, tag: string): string | null {
  const m = chunk.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"),
  );
  if (!m) return null;
  return cleanText(m[1].replace(/<!\[CDATA\[|\]\]>/g, ""));
}

/** Normalise an arXiv Atom feed (regex-based; no XML dependency). */
export function normalizeArxivXml(xml: string): Paper[] {
  if (typeof xml !== "string") return [];
  const papers: Paper[] = [];
  for (const m of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) {
    const chunk = m[1];
    const title = tagText(chunk, "title");
    const idUrl = tagText(chunk, "id");
    if (!title || !idUrl) continue;
    const arxivId = normalizeArxivId(arxivIdFromUrl(idUrl) ?? idUrl);
    const authors = [
      ...chunk.matchAll(
        /<author(?:\s[^>]*)?>[\s\S]*?<name>([\s\S]*?)<\/name>/gi,
      ),
    ]
      .map((a) => cleanText(a[1]))
      .filter((n): n is string => n !== null);
    const pdfTag = chunk.match(/<link\b[^>]*title=["']pdf["'][^>]*>/i)?.[0];
    const pdfHref = pdfTag?.match(/href=["']([^"']+)["']/i)?.[1];
    papers.push(
      makePaper("arxiv", {
        title,
        authors,
        year: yearFromDate(tagText(chunk, "published")),
        venue: tagText(chunk, "arxiv:journal_ref"),
        abstract: tagText(chunk, "summary"),
        doi: tagText(chunk, "arxiv:doi"),
        arxivId,
        url: arxivId
          ? `https://arxiv.org/abs/${arxivId}`
          : decodeEntities(idUrl),
        pdfUrl: pdfHref
          ? decodeEntities(pdfHref).replace(/^http:/, "https:")
          : arxivId
            ? `https://arxiv.org/pdf/${arxivId}`
            : null,
      }),
    );
  }
  return papers;
}

export const normalizeArxiv = normalizeArxivXml;

function arxivEscape(query: string): string {
  return query.replace(/[()"]/g, " ").replace(/\s+/g, " ").trim();
}

function arxivDateClause(opts: ProviderSearchOpts): string {
  if (opts.yearFrom === undefined && opts.yearTo === undefined) return "";
  const from = `${opts.yearFrom ?? 1991}01010000`;
  const to = `${opts.yearTo ?? 9999}12312359`;
  return ` AND submittedDate:[${from} TO ${to}]`;
}

/** General all: field query. */
function arxivQueryAll(query: string, opts: ProviderSearchOpts): string {
  return `all:${arxivEscape(query)}${arxivDateClause(opts)}`;
}

/**
 * LitSearch / ML-NLP biased query: same terms restricted to cs.CL|LG|AI.
 * Merged with the general query so non-ML work is not excluded entirely.
 */
function arxivQueryMlNlp(query: string, opts: ProviderSearchOpts): string {
  const q = arxivEscape(query);
  return `(all:${q}) AND (cat:cs.CL OR cat:cs.LG OR cat:cs.AI OR cat:cs.CV)${arxivDateClause(opts)}`;
}

async function fetchArxivFeed(
  searchQuery: string,
  opts: ProviderSearchOpts,
  maxResults: number,
  start = 0,
): Promise<{ ok: true; papers: Paper[] } | { ok: false; error: string }> {
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: String(start),
    max_results: String(maxResults),
    sortBy: "relevance",
  });
  const res = await fetchText(
    `${getProviderBaseUrl("arxiv")}/query?${params}`,
    {
      headers: { "User-Agent": userAgent(opts.mailto) },
      signal: opts.signal,
    },
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, papers: normalizeArxivXml(res.text) };
}

export async function searchArxiv(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("arxiv", opts, async () => {
    const want = clampLimit(opts.limit, 100);
    // Split budget: general + ML/NLP category-scoped (ACL/ICLR-era coverage).
    const half = Math.max(10, Math.ceil(want / 2));
    const [general, ml] = await Promise.all([
      fetchArxivFeed(arxivQueryAll(query, opts), opts, half),
      fetchArxivFeed(arxivQueryMlNlp(query, opts), opts, half),
    ]);
    if (!general.ok && !ml.ok) {
      return { ok: false, error: general.ok ? ml.error! : general.error };
    }
    const merged = [
      ...(general.ok ? general.papers : []),
      ...(ml.ok ? ml.papers : []),
    ];
    // Dedupe by arxiv id / title
    const seen = new Set<string>();
    const out: Paper[] = [];
    for (const p of merged) {
      const key = (p.arxivId ?? p.title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
      if (out.length >= want) break;
    }
    return { ok: true, papers: out };
  });
}

/** Fetch one paper by arXiv id. Never throws. */
export async function fetchArxivPaper(
  arxivId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Paper | null> {
  const id = normalizeArxivId(arxivId);
  if (!id) return null;
  try {
    const res = await fetchText(
      `${getProviderBaseUrl("arxiv")}/query?id_list=${encodeURIComponent(id)}&max_results=1`,
      { signal: opts.signal },
    );
    return res.ok ? (normalizeArxivXml(res.text)[0] ?? null) : null;
  } catch {
    return null;
  }
}
