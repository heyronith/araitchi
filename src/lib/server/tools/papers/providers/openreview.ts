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

/** OpenReview venues that dominate LitSearch / ML-NLP gold. */
const ML_VENUE_HINTS = ["ICLR", "NeurIPS", "ICML", "ACL", "EMNLP", "NAACL"];

export async function searchOpenReview(
  query: string,
  opts: ProviderSearchOpts,
): Promise<ProviderSearchResult> {
  return runProvider("openreview", opts, async () => {
    const want = clampLimit(opts.limit, 100);
    const base = {
      content: "all",
      source: "forum",
      limit: String(want),
    };
    // Primary: full-text term search. Secondary: query + venue tokens so
    // ICLR/NeurIPS/ACL forums surface for LitSearch-style questions.
    const jobs = [
      fetchJson<unknown>(
        `${getProviderBaseUrl("openreview")}/notes/search?${new URLSearchParams(
          {
            ...base,
            term: query,
          },
        )}`,
        {
          headers: { "User-Agent": userAgent(opts.mailto) },
          signal: opts.signal,
        },
      ),
      fetchJson<unknown>(
        `${getProviderBaseUrl("openreview")}/notes/search?${new URLSearchParams(
          {
            ...base,
            term: `${query} ${ML_VENUE_HINTS.slice(0, 3).join(" ")}`,
          },
        )}`,
        {
          headers: { "User-Agent": userAgent(opts.mailto) },
          signal: opts.signal,
        },
      ),
    ];
    const results = await Promise.all(jobs);
    const papers: Paper[] = [];
    const seen = new Set<string>();
    let anyOk = false;
    let lastErr = "openreview_failed";
    for (const res of results) {
      if (!res.ok) {
        lastErr = res.error;
        continue;
      }
      anyOk = true;
      for (const p of normalizeOpenReview(res.data)) {
        const key = p.url ?? p.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        papers.push(p);
        if (papers.length >= want) break;
      }
      if (papers.length >= want) break;
    }
    if (!anyOk) return { ok: false, error: lastErr };
    return { ok: true, papers: papers.slice(0, want) };
  });
}
