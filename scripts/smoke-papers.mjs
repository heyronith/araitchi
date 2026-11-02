#!/usr/bin/env node
/**
 * Manual smoke for paper search providers (real network, no LLM, not run in CI).
 *
 *   pnpm smoke:papers "graph neural networks for molecules"
 *
 * Standalone: plain Node, no TypeScript / `server-only` / app database. It uses
 * minimal inline parsing just to count and dedupe hits per provider.
 *
 * Reads `.env.local` when present (same vars as the app/scripts). Optional env:
 * ARAITCHI_CONTACT_EMAIL, OPENALEX_API_KEY, CORE_API_KEY, SEMANTIC_SCHOLAR_API_KEY,
 * and ARAITCHI_<PROVIDER>_BASE_URL overrides.
 *
 * Exit code is always 0 unless the query is missing; offline runs just print failures.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvLocal();

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: pnpm smoke:papers "<query>"');
  process.exit(1);
}

const LIMIT = 10;
const TIMEOUT_MS = 15_000;
const email = process.env.ARAITCHI_CONTACT_EMAIL?.trim() || "";
const ua = `araitchi-smoke/0.1${email ? ` (mailto:${email})` : ""}`;

function usableKey(name) {
  const v = process.env[name]?.trim();
  if (!v || v.toLowerCase().startsWith("paste")) return null;
  return v;
}

const keyStatus = {
  openalex: usableKey("OPENALEX_API_KEY") ? "keyed" : "keyless",
  core: usableKey("CORE_API_KEY") ? "keyed" : "keyless",
  semantic_scholar: usableKey("SEMANTIC_SCHOLAR_API_KEY") ? "keyed" : "keyless",
  contact_email: email ? "set" : "unset",
};

const base = (name, fallback) =>
  (process.env[`ARAITCHI_${name}_BASE_URL`]?.trim() || fallback).replace(
    /\/+$/,
    "",
  );

async function get(url, headers = {}, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ua, Accept: "application/json", ...headers },
      signal: ctrl.signal,
    });
    if (res.status === 429) throw new Error("rate_limited (HTTP 429)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (opts.expectJson && !ct.includes("json")) {
      const peek = (await res.clone().text()).slice(0, 80).toLowerCase();
      if (
        ct.includes("text/html") ||
        peek.includes("<!doctype") ||
        peek.includes("not a bot")
      ) {
        throw new Error("dblp_bot_challenge (JSON API blocked by bot check)");
      }
      throw new Error(`unexpected content-type: ${ct || "unknown"}`);
    }
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
    const oaKey = usableKey("OPENALEX_API_KEY");
    if (oaKey) p.set("api_key", oaKey);
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
    const key = usableKey("CORE_API_KEY");
    if (!key)
      throw new Error(
        "skipped (add free CORE_API_KEY — https://core.ac.uk/services/api)",
      );
    const p = new URLSearchParams({ q: query, limit: String(LIMIT) });
    const j = await (
      await get(
        `${base("CORE", "https://api.core.ac.uk/v3")}/search/works?${p}`,
        { Authorization: `Bearer ${key}` },
        { timeoutMs: 30_000, expectJson: true },
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
    const s2Key = usableKey("SEMANTIC_SCHOLAR_API_KEY");
    const headers = s2Key ? { "x-api-key": s2Key } : {};
    let res;
    try {
      res = await get(
        `${base("SEMANTIC_SCHOLAR", "https://api.semanticscholar.org/graph/v1")}/paper/search?${p}`,
        headers,
        { expectJson: true },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429") || msg.includes("rate_limited")) {
        throw new Error(
          s2Key
            ? "rate_limited"
            : "rate_limited (add free SEMANTIC_SCHOLAR_API_KEY — https://www.semanticscholar.org/product/api#api-key-form)",
        );
      }
      throw e;
    }
    const j = await res.json();
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
    const res = await get(
      `${base("DBLP", "https://dblp.org/search/publ/api")}?${p}`,
      { Accept: "application/json" },
      { expectJson: true },
    );
    const j = await res.json();
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

console.log(`query: ${query}`);
console.log(
  `keys: openalex=${keyStatus.openalex} core=${keyStatus.core} semantic_scholar=${keyStatus.semantic_scholar} contact_email=${keyStatus.contact_email}\n`,
);
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
