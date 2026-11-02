import "server-only";

import { getProviderBaseUrl } from "../env";
import type { Paper, ProviderSearchResult } from "../types";
import { fetchJson } from "./http";
import {
  arxivIdFromUrl,
  asArr,
  asObj,
  asStr,
  asYear,
  clampLimit,
  cleanText,
  makePaper,
  runProvider,
  userAgent,
  type ProviderSearchOpts,
} from "./util";

function authorName(a: unknown): string | null {
  const name = typeof a === "string" ? a : asStr(asObj(a).text);
  // DBLP disambiguates homonyms with a numeric suffix ("George E. Dahl 0001").
  return name ? name.replace(/\s+\d{4}$/, "").trim() || null : null;
}

/** Normalise a DBLP publication-search JSON response. */
export function normalizeDblp(raw: unknown): Paper[] {
  const hits = asArr(asObj(asObj(asObj(raw).result).hits).hit);
  const papers: Paper[] = [];
  for (const hit of hits) {
    const info = asObj(asObj(hit).info);
    const title = cleanText(info.title)?.replace(/\.$/, "").trim();
    if (!title) continue;

    const ee = asArr(info.ee)
      .map(asStr)
      .filter((u): u is string => u !== null);
    const venueRaw = asArr(info.venue)
      .map(asStr)
      .filter((v): v is string => v !== null);
    const volume = asStr(info.volume);
    const arxivId: string | null =
      ee.map((u) => arxivIdFromUrl(u)).find((id) => id !== null) ??
      volume?.match(/^abs\/(.+)$/)?.[1] ??
      null;

    papers.push(
      makePaper("dblp", {
        title,
        authors: asArr(asObj(info.authors).author)
          .map(authorName)
          .filter((n): n is string => n !== null),
        year: asYear(info.year),
        venue: venueRaw.length > 0 ? venueRaw.join(", ") : null,
        doi: asStr(info.doi),
        arxivId,
        url: ee[0] ?? asStr(info.url),
        pdfUrl:
          ee.find((u) => /\.pdf(\?|$)|arxiv\.org\/pdf\//i.test(u)) ?? null,
      }),
    );
  }
  return papers;
}

export async function searchDblp(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("dblp", opts, async () => {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      h: String(clampLimit(opts.limit, 1000)),
    });
    const res = await fetchJson<unknown>(
      `${getProviderBaseUrl("dblp")}?${params}`,
      {
        headers: {
          "User-Agent": userAgent(opts.mailto),
          Accept: "application/json",
        },
        signal: opts.signal,
      },
    );
    if (!res.ok) {
      if (
        res.error === "invalid_json" &&
        res.contentType?.toLowerCase().includes("text/html")
      ) {
        return {
          ok: false,
          error: "dblp_bot_challenge (JSON API blocked by bot check)",
        };
      }
      return { ok: false, error: res.error };
    }
    return { ok: true, papers: normalizeDblp(res.data) };
  });
}
