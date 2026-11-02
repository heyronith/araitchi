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

function arxivQuery(query: string, opts: ProviderSearchOpts): string {
  let q = `all:${query.replace(/[()"]/g, " ").replace(/\s+/g, " ").trim()}`;
  if (opts.yearFrom !== undefined || opts.yearTo !== undefined) {
    const from = `${opts.yearFrom ?? 1991}01010000`;
    const to = `${opts.yearTo ?? 9999}12312359`;
    q += ` AND submittedDate:[${from} TO ${to}]`;
  }
  return q;
}

export async function searchArxiv(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("arxiv", opts, async () => {
    const params = new URLSearchParams({
      search_query: arxivQuery(query, opts),
      start: "0",
      max_results: String(clampLimit(opts.limit, 100)),
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
