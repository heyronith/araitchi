import "server-only";

import { getProviderBaseUrl } from "../env";
import type { Paper, ProviderSearchResult } from "../types";
import { fetchJson } from "./http";
import {
  arxivIdFromUrl,
  asArr,
  asNum,
  asObj,
  asStr,
  asYear,
  clampLimit,
  cleanText,
  makePaper,
  optionalSecret,
  runProvider,
  userAgent,
  yearFromDate,
  type ProviderSearchOpts,
} from "./util";

/** Normalise a CORE v3 `search/works` response. */
export function normalizeCore(raw: unknown): Paper[] {
  const items = Array.isArray(raw) ? raw : asArr(asObj(raw).results);
  const papers: Paper[] = [];
  for (const item of items) {
    const w = asObj(item);
    const title = cleanText(w.title);
    if (!title) continue;

    const downloadUrl = asStr(w.downloadUrl);
    const links = asArr(w.links).map(asObj);
    const display = links.find((l) => asStr(l.type) === "display");
    const id = asStr(w.id) ?? (asNum(w.id) !== null ? String(w.id) : null);
    const journal = asStr(asObj(asArr(w.journals)[0]).title);

    papers.push(
      makePaper("core", {
        title,
        authors: asArr(w.authors)
          .map((a) => (typeof a === "string" ? asStr(a) : asStr(asObj(a).name)))
          .filter((n): n is string => n !== null),
        year: asYear(w.yearPublished) ?? yearFromDate(w.publishedDate),
        venue: journal ?? asStr(w.publisher),
        abstract: cleanText(w.abstract),
        doi: asStr(w.doi),
        arxivId: arxivIdFromUrl(downloadUrl),
        url:
          asStr(display?.url) ?? (id ? `https://core.ac.uk/works/${id}` : null),
        pdfUrl: downloadUrl,
        citationCount: asNum(w.citationCount),
      }),
    );
  }
  return papers;
}

export async function searchCore(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("core", opts, async () => {
    const key = optionalSecret("core_api_key");
    if (!key) return { ok: false, error: "core_api_key not configured" };
    const params = new URLSearchParams({
      q: query,
      limit: String(clampLimit(opts.limit, 100)),
    });
    const res = await fetchJson<unknown>(
      `${getProviderBaseUrl("core")}/search/works?${params}`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "User-Agent": userAgent(opts.mailto),
        },
        signal: opts.signal,
      },
    );
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, papers: normalizeCore(res.data) };
  });
}
