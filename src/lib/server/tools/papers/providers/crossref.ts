import "server-only";

import { getProviderBaseUrl } from "../env";
import type { Paper, ProviderSearchResult } from "../types";
import { fetchJson } from "./http";
import {
  asArr,
  asNum,
  asObj,
  asStr,
  asYear,
  clampLimit,
  cleanText,
  encodeDoiPath,
  makePaper,
  runProvider,
  userAgent,
  type ProviderSearchOpts,
} from "./util";

function datePartsYear(v: unknown): number | null {
  const first = asArr(asArr(asObj(v)["date-parts"])[0])[0];
  return asYear(first);
}

/** Normalise a Crossref `/works` response (`{ message: { items } }`). */
export function normalizeCrossref(raw: unknown): Paper[] {
  const message = asObj(asObj(raw).message);
  const items = Array.isArray(raw) ? raw : asArr(message.items);
  const papers: Paper[] = [];
  for (const item of items) {
    const w = asObj(item);
    const title = cleanText(asArr(w.title)[0]);
    if (!title) continue;
    const doi = asStr(w.DOI);
    const pdfLink = asArr(w.link)
      .map(asObj)
      .find((l) => /pdf/i.test(asStr(l["content-type"]) ?? ""));
    papers.push(
      makePaper("crossref", {
        title,
        authors: asArr(w.author)
          .map((a) => {
            const o = asObj(a);
            return (
              [asStr(o.given), asStr(o.family)].filter(Boolean).join(" ") ||
              asStr(o.name)
            );
          })
          .filter((n): n is string => Boolean(n)),
        year:
          datePartsYear(w.issued) ??
          datePartsYear(w["published-print"]) ??
          datePartsYear(w["published-online"]) ??
          datePartsYear(w.created),
        venue: cleanText(asArr(w["container-title"])[0]),
        abstract: cleanText(w.abstract),
        doi,
        url: asStr(w.URL) ?? (doi ? `https://doi.org/${doi}` : null),
        pdfUrl: asStr(pdfLink?.URL),
        citationCount: asNum(w["is-referenced-by-count"]),
      }),
    );
  }
  return papers;
}

export async function searchCrossref(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("crossref", opts, async () => {
    const params = new URLSearchParams({
      "query.bibliographic": query,
      rows: String(clampLimit(opts.limit, 100)),
    });
    if (opts.mailto) params.set("mailto", opts.mailto);
    const filters: string[] = [];
    if (opts.yearFrom !== undefined)
      filters.push(`from-pub-date:${opts.yearFrom}`);
    if (opts.yearTo !== undefined)
      filters.push(`until-pub-date:${opts.yearTo}`);
    if (filters.length > 0) params.set("filter", filters.join(","));
    const res = await fetchJson<unknown>(
      `${getProviderBaseUrl("crossref")}/works?${params}`,
      {
        headers: { "User-Agent": userAgent(opts.mailto) },
        signal: opts.signal,
      },
    );
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, papers: normalizeCrossref(res.data) };
  });
}

/** Fetch one Crossref work by DOI. Never throws. */
export async function fetchCrossrefWork(input: {
  doi: string;
  mailto?: string;
  signal?: AbortSignal;
}): Promise<Paper | null> {
  const doi = input.doi.trim();
  if (!doi) return null;
  try {
    const params = new URLSearchParams();
    if (input.mailto) params.set("mailto", input.mailto);
    const qs = params.toString();
    const res = await fetchJson<unknown>(
      `${getProviderBaseUrl("crossref")}/works/${encodeDoiPath(doi)}${qs ? `?${qs}` : ""}`,
      {
        headers: { "User-Agent": userAgent(input.mailto) },
        signal: input.signal,
      },
    );
    if (!res.ok) return null;
    // Single-work responses are `{ message: { DOI, title, ... } }` — wrap as items.
    const message = asObj(asObj(res.data).message);
    if (message.DOI || message.title) {
      return normalizeCrossref({ message: { items: [message] } })[0] ?? null;
    }
    return normalizeCrossref(res.data)[0] ?? null;
  } catch {
    return null;
  }
}
