#!/usr/bin/env node
/**
 * Manual smoke for paper search providers (real network, no LLM, not run in CI).
 *
 *   pnpm smoke:papers "graph neural networks for molecules"
 *
 * Standalone: plain Node, no TypeScript / `server-only` / app database. It uses
 * minimal inline parsing just to count and dedupe hits per provider.
 *
 * Optional env: ARAITCHI_CONTACT_EMAIL, OPENALEX_API_KEY, CORE_API_KEY (CORE is
 * skipped without it), SEMANTIC_SCHOLAR_API_KEY, and ARAITCHI_<PROVIDER>_BASE_URL
 * overrides (OPENALEX, CORE, SEMANTIC_SCHOLAR, ARXIV, DBLP, OPENREVIEW, CROSSREF).
 *
 * Exit code is always 0 unless the query is missing; offline runs just print failures.
 */

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: pnpm smoke:papers "<query>"');
  process.exit(1);
}

const LIMIT = 10;
const TIMEOUT_MS = 15_000;
const email = process.env.ARAITCHI_CONTACT_EMAIL?.trim() || "";
const ua = `araitchi-smoke/0.1${email ? ` (mailto:${email})` : ""}`;

const base = (name, fallback) =>
  (process.env[`ARAITCHI_${name}_BASE_URL`]?.trim() || fallback).replace(
    /\/+$/,
    "",
  );

async function get(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ua, ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const doiOf = (d) =>
  d
    ? String(d)
        .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
        .toLowerCase()
    : null;
const arxivOf = (s) => {
  const m = String(s ?? "").match(
    /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:v\d+)?(?:\.pdf)?(?:[?#]|$)/i,
  );
  return m ? m[1].toLowerCase() : null;
};
const clean = (s) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const providers = {
  async openalex() {
    const p = new URLSearchParams({ search: query, per_page: String(LIMIT) });
    if (email) p.set("mailto", email);
    if (process.env.OPENALEX_API_KEY)
      p.set("api_key", process.env.OPENALEX_API_KEY);
    const j = await (
      await get(`${base("OPENALEX", "https://api.openalex.org")}/works?${p}`)
    ).json();
    return arr(j.results).map((w) => ({
      title: w.title ?? w.display_name,
      year: w.publication_year,
      doi: doiOf(w.doi),
    }));
  },
  async core() {
    const key = process.env.CORE_API_KEY;
    if (!key) throw new Error("skipped (set CORE_API_KEY)");
    const p = new URLSearchParams({ q: query, limit: String(LIMIT) });
    const j = await (
      await get(
        `${base("CORE", "https://api.core.ac.uk/v3")}/search/works?${p}`,
        {
          Authorization: `Bearer ${key}`,
        },
      )
    ).json();
    return arr(j.results).map((w) => ({
      title: w.title,
      year: w.yearPublished,
      doi: doiOf(w.doi),
    }));
  },
  async semantic_scholar() {
    const p = new URLSearchParams({
      query,
      limit: String(LIMIT),
      fields: "title,year,externalIds",
    });
    const headers = process.env.SEMANTIC_SCHOLAR_API_KEY
      ? { "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY }
      : {};
    const j = await (
      await get(
        `${base("SEMANTIC_SCHOLAR", "https://api.semanticscholar.org/graph/v1")}/paper/search?${p}`,
        headers,
      )
    ).json();
    return arr(j.data).map((w) => ({
      title: w.title,
      year: w.year,
      doi: doiOf(w.externalIds?.DOI),
      arxiv: w.externalIds?.ArXiv?.replace(/v\d+$/, "").toLowerCase(),
    }));
  },
  async arxiv() {
    const p = new URLSearchParams({
      search_query: `all:${query}`,
      max_results: String(LIMIT),
    });
    const xml = await (
      await get(`${base("ARXIV", "http://export.arxiv.org/api")}/query?${p}`)
    ).text();
    return [...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)].map((m) => {
      const e = m[1];
      return {
        title: clean(e.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]),
        year: Number(e.match(/<published>(\d{4})/i)?.[1]) || null,
        arxiv: arxivOf(e.match(/<id>([^<]+)<\/id>/i)?.[1]),
        doi: doiOf(e.match(/<arxiv:doi[^>]*>([^<]+)</i)?.[1]),
      };
    });
  },
  async dblp() {
    const p = new URLSearchParams({
      q: query,
      format: "json",
      h: String(LIMIT),
    });
    const j = await (
      await get(`${base("DBLP", "https://dblp.org/search/publ/api")}?${p}`)
    ).json();
    return arr(j.result?.hits?.hit).map((h) => ({
      title: clean(h.info?.title).replace(/\.$/, ""),
      year: Number(h.info?.year) || null,
      doi: doiOf(h.info?.doi),
      arxiv: arr(h.info?.ee).map(arxivOf).find(Boolean),
    }));
  },
  async openreview() {
    const p = new URLSearchParams({
      term: query,
      content: "all",
      source: "forum",
      limit: String(LIMIT),
    });
    const j = await (
      await get(
        `${base("OPENREVIEW", "https://api2.openreview.net")}/notes/search?${p}`,
      )
    ).json();
    return arr(j.notes).map((n) => ({
      title: clean(n.content?.title?.value ?? n.content?.title),
      year: n.cdate ? new Date(n.cdate).getUTCFullYear() : null,
    }));
  },
  async crossref() {
    const p = new URLSearchParams({
      "query.bibliographic": query,
      rows: String(LIMIT),
    });
    if (email) p.set("mailto", email);
    const j = await (
      await get(`${base("CROSSREF", "https://api.crossref.org")}/works?${p}`)
    ).json();
    return arr(j.message?.items).map((w) => ({
      title: clean(arr(w.title)[0]),
      year: w.issued?.["date-parts"]?.[0]?.[0] ?? null,
      doi: doiOf(w.DOI),
    }));
  },
};

const key = (p) =>
  p.doi
    ? `doi:${p.doi}`
    : p.arxiv
      ? `arxiv:${p.arxiv}`
      : `title:${clean(p.title)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()}|${p.year ?? ""}`;

console.log(`query: ${query}\n`);
const started = Date.now();
const results = await Promise.all(
  Object.entries(providers).map(async ([name, run]) => {
    const t0 = Date.now();
    try {
      const papers = (await run()).filter((p) => p.title);
      return { name, ok: true, papers, ms: Date.now() - t0 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cause =
        e instanceof Error && e.cause
          ? ` (${e.cause.code ?? e.cause.message})`
          : "";
      return {
        name,
        ok: false,
        error: msg + cause,
        papers: [],
        ms: Date.now() - t0,
      };
    }
  }),
);

for (const r of results) {
  console.log(
    `${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(17)} ${String(r.ms).padStart(6)}ms  ${r.ok ? `${r.papers.length} papers` : r.error}`,
  );
}

const raw = results.reduce((n, r) => n + r.papers.length, 0);
const unique = new Set(results.flatMap((r) => r.papers.map(key)));
const withHits = results.filter((r) => r.papers.length > 0).length;
console.log(
  `\nraw hits: ${raw} | unique (approx. DOI/arXiv/title): ${unique.size} | providers with results: ${withHits}/${results.length} | total ${Date.now() - started}ms`,
);
