import "server-only";

import { getSecret } from "@/lib/server/secrets";

import { normalizeArxivId, normalizeDoi } from "../merge";
import type { Paper, PaperProvider, ProviderSearchResult } from "../types";

/** Options shared by every provider search function. */
export type ProviderSearchOpts = {
  limit: number;
  yearFrom?: number;
  yearTo?: number;
  /** Contact email for the "polite pool" (OpenAlex, Crossref, Unpaywall). */
  mailto?: string;
  signal?: AbortSignal;
};

export function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

export function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Array as-is; a lone value is wrapped; null/undefined become []. */
export function asArr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === null || v === undefined ? [] : [v];
}

export function asYear(v: unknown): number | null {
  const n = asNum(v);
  return n !== null && n >= 1000 && n <= 3000 ? Math.trunc(n) : null;
}

export function yearFromDate(v: unknown): number | null {
  if (typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : asYear(d.getUTCFullYear());
  }
  const s = asStr(v);
  const m = s?.match(/^(\d{4})/);
  return m ? asYear(m[1]) : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === "#") {
      const code =
        ent[1]?.toLowerCase() === "x"
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? m;
  });
}

/** Strip markup (JATS/HTML), decode entities and collapse whitespace. */
export function cleanText(v: unknown): string | null {
  const s = asStr(v);
  if (!s) return null;
  const out = decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return out.length > 0 ? out : null;
}

/** arXiv id from an arXiv DataCite DOI (`10.48550/arXiv.<id>`). */
export function arxivIdFromDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const m = doi.match(/^10\.48550\/arxiv\.(.+)$/i);
  return m ? m[1] : null;
}

/** arXiv id from an arxiv.org abs/pdf URL (version kept; callers normalise). */
export function arxivIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(
    /arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?(?:[?#]|$)/i,
  );
  return m ? m[1] : null;
}

/** Encode a DOI for use in a URL path while keeping its `/` separators. */
export function encodeDoiPath(doi: string): string {
  return doi.split("/").map(encodeURIComponent).join("/");
}

/** Build a complete Paper, normalising the DOI / arXiv id and deriving one from the other when possible. */
export function makePaper(
  provider: PaperProvider,
  p: Partial<Omit<Paper, "foundBy">> & { title: string },
): Paper {
  const doi = normalizeDoi(p.doi ?? null);
  const arxivId = normalizeArxivId(p.arxivId ?? null) ?? arxivIdFromDoi(doi);
  return {
    title: p.title,
    authors: p.authors ?? [],
    year: p.year ?? null,
    venue: p.venue ?? null,
    abstract: p.abstract ?? null,
    doi,
    arxivId: arxivId ? normalizeArxivId(arxivId) : null,
    url: p.url ?? null,
    pdfUrl: p.pdfUrl ?? null,
    citationCount: p.citationCount ?? null,
    foundBy: [provider],
  };
}

/** Optional API key from the encrypted store; never throws. */
export function optionalSecret(name: string): string | null {
  try {
    return getSecret(name);
  } catch {
    return null;
  }
}

export function userAgent(mailto?: string): string {
  return `araitchi/0.1${mailto ? ` (mailto:${mailto})` : ""}`;
}

export function clampLimit(limit: number, max = 50): number {
  return Math.min(Math.max(Math.trunc(limit) || 1, 1), max);
}

function inYearRange(p: Paper, opts: ProviderSearchOpts): boolean {
  if (p.year === null) return true;
  if (opts.yearFrom !== undefined && p.year < opts.yearFrom) return false;
  if (opts.yearTo !== undefined && p.year > opts.yearTo) return false;
  return true;
}

/**
 * Run a provider search with timing. Never throws: failures (including
 * thrown errors) become `{ ok: false, error }`. Year bounds are also enforced
 * client-side for providers whose API lacks a year filter.
 */
export async function runProvider(
  provider: PaperProvider,
  opts: ProviderSearchOpts,
  fn: () => Promise<
    { ok: true; papers: Paper[] } | { ok: false; error: string }
  >,
): Promise<ProviderSearchResult> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { provider, ok: false, error: res.error, papers: [], latencyMs };
    }
    return {
      provider,
      ok: true,
      papers: res.papers.filter((p) => inYearRange(p, opts)),
      latencyMs,
    };
  } catch (e) {
    return {
      provider,
      ok: false,
      error: e instanceof Error ? e.message : "Provider failed",
      papers: [],
      latencyMs: Date.now() - t0,
    };
  }
}
