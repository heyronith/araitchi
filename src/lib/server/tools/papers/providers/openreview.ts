import "server-only";

import { getProviderBaseUrl } from "../env";
import type { Paper, ProviderSearchResult } from "../types";
import { fetchJson } from "./http";
import {
  asArr,
  asObj,
  asStr,
  clampLimit,
  cleanText,
  makePaper,
  runProvider,
  userAgent,
  yearFromDate,
  type ProviderSearchOpts,
} from "./util";

/** API v2 wraps each content field as `{ value }`; v1 uses plain values. */
function field(content: Record<string, unknown>, key: string): unknown {
  const v = content[key];
  return v && typeof v === "object" && !Array.isArray(v) && "value" in v
    ? (v as { value: unknown }).value
    : v;
}

/** Normalise an OpenReview `notes/search` response. */
export function normalizeOpenReview(raw: unknown): Paper[] {
  const notes = Array.isArray(raw) ? raw : asArr(asObj(raw).notes);
  const papers: Paper[] = [];
  for (const n of notes) {
    const note = asObj(n);
    const content = asObj(note.content);
    const title = cleanText(field(content, "title"));
    const id = asStr(note.forum) ?? asStr(note.id);
    if (!title || !id) continue;

    const pdf = asStr(field(content, "pdf"));
    papers.push(
      makePaper("openreview", {
        title,
        authors: asArr(field(content, "authors"))
          .map(asStr)
          .filter((a): a is string => a !== null),
        year: yearFromDate(note.pdate ?? note.cdate ?? note.tcdate),
        venue: asStr(field(content, "venue")),
        abstract: cleanText(field(content, "abstract")),
        doi: null,
        url: `https://openreview.net/forum?id=${encodeURIComponent(id)}`,
        pdfUrl: pdf
          ? pdf.startsWith("http")
            ? pdf
            : `https://openreview.net${pdf.startsWith("/") ? "" : "/"}${pdf}`
          : `https://openreview.net/pdf?id=${encodeURIComponent(id)}`,
      }),
    );
  }
  return papers;
}

export async function searchOpenReview(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("openreview", opts, async () => {
    const params = new URLSearchParams({
      term: query,
      content: "all",
      source: "forum",
      limit: String(clampLimit(opts.limit, 100)),
    });
    const res = await fetchJson<unknown>(
      `${getProviderBaseUrl("openreview")}/notes/search?${params}`,
      {
        headers: { "User-Agent": userAgent(opts.mailto) },
        signal: opts.signal,
      },
    );
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, papers: normalizeOpenReview(res.data) };
  });
}
