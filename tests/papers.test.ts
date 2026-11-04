import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setSecret } from "@/lib/server/secrets";
import * as secretsModule from "@/lib/server/secrets";
import {
  fingerprint,
  mergePapers,
  normalizeArxivId,
  normalizeDoi,
  rrfRank,
} from "@/lib/server/tools/papers/merge";
import {
  normalizeArxivXml,
  normalizeCore,
  normalizeCrossref,
  normalizeDblp,
  normalizeOpenAlex,
  normalizeOpenReview,
  normalizeSemanticScholar,
  normalizeUnpaywall,
  searchCore,
  searchDblp,
  searchOpenAlex,
} from "@/lib/server/tools/papers/providers";
import {
  isUsableSecret,
  optionalSecret,
} from "@/lib/server/tools/papers/providers/util";
import {
  getPaper,
  paperLinks,
  searchPapers,
} from "@/lib/server/tools/papers/search";
import {
  createPaperTools,
  providerFailureKind,
} from "@/lib/server/tools/papers/tools";
import type { Paper } from "@/lib/server/tools/papers/types";

const fixtureDir = path.join(process.cwd(), "tests/fixtures/papers");
const text = (name: string) =>
  readFileSync(path.join(fixtureDir, name), "utf8");
const json = (name: string): unknown => JSON.parse(text(name));

const GCN_ARXIV = "1609.02907";
const MPNN_DOI = "10.48550/arxiv.1704.01212";
const CHEMPROP_DOI = "10.1021/acs.jcim.9b00237";

function paper(over: Partial<Paper>): Paper {
  return {
    title: "T",
    authors: [],
    year: 2020,
    venue: null,
    abstract: null,
    doi: null,
    arxivId: null,
    url: null,
    pdfUrl: null,
    citationCount: null,
    foundBy: ["openalex"],
    ...over,
  };
}

function allFixturePapers() {
  return {
    openalex: normalizeOpenAlex(json("openalex.json")),
    semantic_scholar: normalizeSemanticScholar(json("semantic_scholar.json")),
    core: normalizeCore(json("core.json")),
    crossref: normalizeCrossref(json("crossref.json")),
    dblp: normalizeDblp(json("dblp.json")),
    openreview: normalizeOpenReview(json("openreview.json")),
    arxiv: normalizeArxivXml(text("arxiv.xml")),
  };
}

describe("optionalSecret and failure kinds", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("optionalSecret falls back to env and ignores paste placeholders", () => {
    vi.spyOn(secretsModule, "getSecret").mockImplementation(() => {
      throw new Error("missing");
    });
    // Clear any developer .env.local values so the unit test is deterministic.
    vi.stubEnv("OPENALEX_API_KEY", "");
    expect(optionalSecret("openalex_api_key")).toBeNull();
    vi.stubEnv("OPENALEX_API_KEY", "paste-your-key-here");
    expect(optionalSecret("openalex_api_key")).toBeNull();
    vi.stubEnv("OPENALEX_API_KEY", "oa-live-key");
    expect(optionalSecret("openalex_api_key")).toBe("oa-live-key");
  });

  it("isUsableSecret rejects empty and paste placeholders", () => {
    expect(isUsableSecret("")).toBe(false);
    expect(isUsableSecret("paste key")).toBe(false);
    expect(isUsableSecret("sk-real")).toBe(true);
  });

  it("providerFailureKind classifies errors", () => {
    expect(providerFailureKind("rate_limited")).toBe("rate_limit");
    expect(providerFailureKind("core_api_key not configured")).toBe("no_key");
    expect(providerFailureKind("dblp_returned_html")).toBe("error");
    expect(
      providerFailureKind("dblp_bot_challenge (JSON API blocked by bot check)"),
    ).toBe("error");
  });
});

describe("provider normalizers", () => {
  it("openalex: DOI, arXiv id from DOI, abstract from inverted index", () => {
    const [gcn, , chemprop] = normalizeOpenAlex(json("openalex.json"));
    expect(gcn.doi).toBe("10.48550/arxiv.1609.02907");
    expect(gcn.arxivId).toBe(GCN_ARXIV);
    expect(gcn.year).toBe(2016);
    expect(gcn.authors).toEqual(["Thomas N. Kipf", "Max Welling"]);
    expect(gcn.abstract).toMatch(/^We present a scalable approach/);
    expect(gcn.citationCount).toBe(24500);
    expect(gcn.pdfUrl).toBe("https://arxiv.org/pdf/1609.02907");
    expect(gcn.foundBy).toEqual(["openalex"]);
    expect(chemprop.doi).toBe(CHEMPROP_DOI);
    expect(chemprop.abstract).toBeNull();
    expect(chemprop.pdfUrl).toBeNull();
  });

  it("semantic scholar: strips arXiv version, keeps DOI", () => {
    const papers = normalizeSemanticScholar(json("semantic_scholar.json"));
    expect(papers).toHaveLength(3);
    expect(papers[0].arxivId).toBe(GCN_ARXIV);
    expect(papers[0].doi).toBeNull();
    expect(papers[1].arxivId).toBe("1704.01212");
    expect(papers[1].doi).toBe(MPNN_DOI);
    expect(papers[2].doi).toBe(CHEMPROP_DOI);
    expect(papers[0].pdfUrl).toBe("https://arxiv.org/pdf/1609.02907");
  });

  it("core: lowercases DOI, uses journal title as venue", () => {
    const papers = normalizeCore(json("core.json"));
    expect(papers).toHaveLength(2);
    expect(papers[0].arxivId).toBe("1810.00826");
    expect(papers[1].doi).toBe(CHEMPROP_DOI);
    expect(papers[1].venue).toBe(
      "Journal of Chemical Information and Modeling",
    );
    expect(papers[1].authors).toHaveLength(4);
  });

  it("crossref: JATS abstract stripped, year from issued/published-print, PDF link", () => {
    const [a, b] = normalizeCrossref(json("crossref.json"));
    expect(a.doi).toBe(CHEMPROP_DOI);
    expect(a.year).toBe(2019);
    expect(a.abstract).toMatch(/^Advancements in neural machinery/);
    expect(a.abstract).not.toContain("<");
    expect(a.pdfUrl).toContain("pubs.acs.org");
    expect(a.authors[0]).toBe("Kevin Yang");
    expect(b.year).toBe(2016);
    expect(b.venue).toBe("Journal of Computer-Aided Molecular Design");
  });

  it("dblp: trailing dot, homonym suffix, arXiv id from ee link", () => {
    const [gcn, mpnn] = normalizeDblp(json("dblp.json"));
    expect(gcn.title).toBe(
      "Semi-Supervised Classification with Graph Convolutional Networks",
    );
    expect(gcn.arxivId).toBe(GCN_ARXIV);
    expect(gcn.year).toBe(2016);
    expect(mpnn.authors.at(-1)).toBe("George E. Dahl");
    expect(mpnn.doi).toBe(MPNN_DOI);
    expect(mpnn.arxivId).toBe("1704.01212");
  });

  it("openreview: v2 value-wrapped content", () => {
    const [a] = normalizeOpenReview(json("openreview.json"));
    expect(a.title).toBe(
      "Semi-Supervised Classification with Graph Convolutional Networks",
    );
    expect(a.authors).toEqual(["Thomas N. Kipf", "Max Welling"]);
    expect(a.venue).toBe("ICLR 2017 Poster");
    expect(a.year).toBe(2016);
    expect(a.url).toBe("https://openreview.net/forum?id=SJU4ayYgl");
    expect(a.pdfUrl).toBe("https://openreview.net/pdf/0a1b2c3d4e5f.pdf");
  });

  it("arxiv: Atom entries, whitespace collapsed, entities decoded, version stripped", () => {
    const papers = normalizeArxivXml(text("arxiv.xml"));
    expect(papers).toHaveLength(3);
    expect(papers[0].title).toBe(
      "Semi-Supervised Classification with Graph Convolutional Networks",
    );
    expect(papers[0].arxivId).toBe(GCN_ARXIV);
    expect(papers[0].year).toBe(2016);
    expect(papers[0].url).toBe("https://arxiv.org/abs/1609.02907");
    expect(papers[0].pdfUrl).toBe("https://arxiv.org/pdf/1609.02907v4");
    expect(papers[1].venue).toBe("ICML 2017");
    expect(papers[2].doi).toBe("10.48550/arxiv.1810.00826");
    expect(papers[2].abstract).toContain("scheme & we");
  });

  it("unpaywall: best OA PDF", () => {
    const oa = normalizeUnpaywall(json("unpaywall.json"));
    expect(oa?.isOa).toBe(true);
    expect(oa?.pdfUrl).toContain("PMC6727618/pdf");
    expect(normalizeUnpaywall({})).toBeNull();
  });

  it("tolerates garbage input", () => {
    for (const fn of [
      normalizeOpenAlex,
      normalizeSemanticScholar,
      normalizeCore,
      normalizeCrossref,
      normalizeDblp,
      normalizeOpenReview,
    ]) {
      expect(fn(null)).toEqual([]);
      expect(fn("nope")).toEqual([]);
      expect(fn({ results: [null, 3, {}], data: [{}], notes: [{}] })).toEqual(
        [],
      );
    }
    expect(normalizeArxivXml("")).toEqual([]);
    expect(normalizeArxivXml("<feed></feed>")).toEqual([]);
  });
});

describe("merge and rank", () => {
  it("normalizes ids and fingerprints (DOI > arXiv > title+year)", () => {
    expect(normalizeDoi("https://doi.org/10.1/ABC")).toBe("10.1/abc");
    expect(normalizeArxivId("arXiv:2301.12345v2")).toBe("2301.12345");
    expect(fingerprint(paper({ doi: "10.1/X", arxivId: "1.1" }))).toBe(
      "doi:10.1/x",
    );
    expect(fingerprint(paper({ arxivId: "2301.1v3" }))).toBe("arxiv:2301.1");
    expect(fingerprint(paper({ title: "Hello, World!" }))).toBe(
      "title:hello world|2020",
    );
  });

  it("merges the overlapping DOI across 4 providers", () => {
    const f = allFixturePapers();
    const merged = mergePapers([
      f.openalex,
      f.semantic_scholar,
      f.core,
      f.crossref,
    ]);
    const hits = merged.filter((p) => p.doi === CHEMPROP_DOI);
    expect(hits).toHaveLength(1);
    expect(hits[0].foundBy.sort()).toEqual(
      ["core", "crossref", "openalex", "semantic_scholar"].sort(),
    );
    // Prefers the longest abstract and the max citation count.
    expect(hits[0].abstract).toMatch(/graph convolutional neural networks\.$/);
    expect(hits[0].citationCount).toBe(1520);
    expect(hits[0].authors).toHaveLength(4);
  });

  it("links DOI-less preprints to DOI records via arXiv id and title", () => {
    const f = allFixturePapers();
    const merged = mergePapers(Object.values(f));
    const gcn = merged.filter((p) => p.arxivId === GCN_ARXIV);
    expect(gcn).toHaveLength(1);
    expect(gcn[0].doi).toBe("10.48550/arxiv.1609.02907");
    // openalex + semantic_scholar + dblp + arxiv (+ openreview via title/year)
    expect(gcn[0].foundBy).toEqual(
      expect.arrayContaining([
        "openalex",
        "semantic_scholar",
        "dblp",
        "arxiv",
        "openreview",
      ]),
    );
    const mpnn = merged.filter((p) => p.doi === MPNN_DOI);
    expect(mpnn).toHaveLength(1);
    expect(mpnn[0].foundBy).toEqual(
      expect.arrayContaining(["openalex", "semantic_scholar", "dblp", "arxiv"]),
    );
  });

  it("rrf ranks multi-provider papers first and de-duplicates", () => {
    const f = allFixturePapers();
    const lists = [
      f.openalex,
      f.semantic_scholar,
      f.core,
      f.crossref,
      f.dblp,
      f.openreview,
      f.arxiv,
    ];
    const ranked = rrfRank(lists);
    const total = lists.reduce((n, l) => n + l.length, 0);
    expect(ranked.length).toBeLessThan(total);
    expect(new Set(ranked.map((p) => p.title.toLowerCase())).size).toBe(
      ranked.length,
    );
    expect(ranked[0].foundBy.length).toBeGreaterThanOrEqual(4);
    const solo = ranked.find((p) => p.foundBy.length === 1);
    expect(solo).toBeDefined();
    expect(ranked.indexOf(solo!)).toBeGreaterThan(0);
  });

  it("rrf: lower rank within a single list wins when otherwise equal", () => {
    const a = paper({ title: "A", doi: "10.1/a" });
    const b = paper({ title: "B", doi: "10.1/b" });
    expect(rrfRank([[a, b]]).map((p) => p.doi)).toEqual(["10.1/a", "10.1/b"]);
  });
});

describe("mocked-network search", () => {
  type Handler = (url: URL) => Response | null;
  let calls: string[];
  let overrides: Record<string, Handler>;

  const ok = (body: string) =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  function route(url: URL): Response {
    const key = url.hostname;
    const custom = overrides[key]?.(url);
    if (custom) return custom;
    const p = url.pathname;
    switch (key) {
      case "api.openalex.org":
        return ok(text("openalex.json"));
      case "api.semanticscholar.org":
        return ok(text("semantic_scholar.json"));
      case "api.core.ac.uk":
        return ok(text("core.json"));
      case "export.arxiv.org":
        return ok(text("arxiv.xml"));
      case "dblp.org":
        return ok(text("dblp.json"));
      case "api2.openreview.net":
        return ok(text("openreview.json"));
      case "api.crossref.org":
        return ok(text("crossref.json"));
      case "api.unpaywall.org":
        return ok(text("unpaywall.json"));
      default:
        return new Response(`unexpected ${key}${p}`, { status: 404 });
    }
  }

  beforeEach(() => {
    calls = [];
    overrides = {};
    // Isolate from developer .env.local keys for deterministic provider outcomes.
    vi.stubEnv("CORE_API_KEY", "");
    vi.stubEnv("OPENALEX_API_KEY", "");
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input.toString(),
        );
        calls.push(url.toString());
        return route(url);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("searches all providers in parallel and merges", async () => {
    setSecret("core_api_key", "test-key");
    const { papers, providers } = await searchPapers({
      query: "graph neural networks",
      limit: 10,
    });
    expect(providers.map((p) => p.provider).sort()).toEqual(
      [
        "arxiv",
        "core",
        "crossref",
        "dblp",
        "openalex",
        "openreview",
        "semantic_scholar",
      ].sort(),
    );
    expect(providers.every((p) => p.ok)).toBe(true);
    expect(providers.every((p) => p.latencyMs >= 0)).toBe(true);
    const raw = providers.reduce((n, p) => n + p.papers.length, 0);
    expect(papers.length).toBeLessThan(raw);
    expect(papers[0].foundBy.length).toBeGreaterThanOrEqual(4);
    expect(papers.filter((p) => p.arxivId === GCN_ARXIV)).toHaveLength(1);
  });

  it("sends the query, limit, year filter and CORE bearer key", async () => {
    setSecret("core_api_key", "test-key");
    await searchPapers({
      query: "graph networks",
      limit: 7,
      yearFrom: 2018,
      yearTo: 2020,
      contactEmail: "me@example.org",
    });
    const oa = calls.find((c) => c.includes("api.openalex.org/works?"))!;
    expect(oa).toContain("search=graph+networks");
    expect(oa).toContain("per_page=7");
    expect(oa).toContain("from_publication_date%3A2018-01-01");
    expect(oa).toContain("mailto=me%40example.org");
    const s2 = calls.find((c) => c.includes("semanticscholar.org"))!;
    expect(s2).toContain("year=2018-2020");
    const fetchMock = vi.mocked(fetch);
    const coreCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("core.ac.uk"),
    );
    expect(
      (coreCall?.[1]?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer test-key");
  });

  it("applies the year range client-side", async () => {
    setSecret("core_api_key", "test-key");
    const { papers } = await searchPapers({
      query: "x",
      yearFrom: 2019,
      yearTo: 2019,
    });
    expect(papers.length).toBeGreaterThan(0);
    expect(papers.every((p) => p.year === null || p.year === 2019)).toBe(true);
  });

  it("one failing provider never fails the search", async () => {
    overrides["api.openalex.org"] = () => new Response("boom", { status: 500 });
    overrides["dblp.org"] = () => {
      throw new Error("socket hang up");
    };
    const { papers, providers } = await searchPapers({ query: "x", limit: 10 });
    const by = Object.fromEntries(providers.map((p) => [p.provider, p]));
    expect(by.openalex.ok).toBe(false);
    expect(by.openalex.error).toBe("HTTP 500");
    expect(by.openalex.papers).toEqual([]);
    expect(by.dblp.ok).toBe(false);
    expect(by.dblp.error).toContain("socket hang up");
    expect(by.semantic_scholar.ok).toBe(true);
    // CORE has no key configured in this test.
    expect(by.core.ok).toBe(false);
    expect(by.core.error).toContain("core_api_key");
    expect(papers.length).toBeGreaterThan(0);
  });

  it("honours enabledProviders and survives malformed bodies", async () => {
    overrides["api.crossref.org"] = () => ok("{ not json");
    const { providers } = await searchPapers({
      query: "x",
      enabledProviders: ["crossref", "arxiv"],
    });
    expect(providers.map((p) => p.provider).sort()).toEqual([
      "arxiv",
      "crossref",
    ]);
    const crossref = providers.find((p) => p.provider === "crossref");
    expect(crossref?.ok).toBe(false);
    expect(crossref?.error).toBe("invalid_json");
    expect(providers.find((p) => p.provider === "arxiv")?.ok).toBe(true);
    expect(calls.some((c) => c.includes("openalex"))).toBe(false);
  });

  it("dblp reports HTML responses as dblp_bot_challenge", async () => {
    overrides["dblp.org"] = () =>
      new Response("<html><body>DBLP</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    const res = await searchDblp("gnn", { limit: 5 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("dblp_bot_challenge");
  });

  it("dblp accepts JSON fixture", async () => {
    const res = await searchDblp("graph", { limit: 5 });
    expect(res.ok).toBe(true);
    expect(res.papers.length).toBeGreaterThan(0);
  });

  it("provider search functions never throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const res = await searchOpenAlex("x", { limit: 5 });
    expect(res).toMatchObject({
      provider: "openalex",
      ok: false,
      papers: [],
    });
    const core = await searchCore("x", { limit: 5 });
    expect(core.ok).toBe(false);
    expect(await searchPapers({ query: "   " })).toEqual({
      papers: [],
      providers: [],
    });
  }, 20_000);

  it("getPaper merges sources and adds an Unpaywall PDF", async () => {
    overrides["api.semanticscholar.org"] = (url) =>
      url.pathname.includes("/paper/DOI:")
        ? ok(
            JSON.stringify(
              (json("semantic_scholar.json") as { data: unknown[] }).data[2],
            ),
          )
        : null;
    overrides["api.openalex.org"] = (url) =>
      url.pathname.includes("/works/doi:")
        ? ok(
            JSON.stringify(
              (json("openalex.json") as { results: unknown[] }).results[2],
            ),
          )
        : null;
    overrides["api.crossref.org"] = () => new Response("", { status: 404 });
    const p = await getPaper({
      doi: `https://doi.org/${CHEMPROP_DOI.toUpperCase()}`,
      contactEmail: "me@example.org",
    });
    expect(p?.doi).toBe(CHEMPROP_DOI);
    expect(p?.foundBy).toEqual(
      expect.arrayContaining(["openalex", "semantic_scholar"]),
    );
    expect(p?.abstract).toContain("molecular property prediction");
    expect(p?.pdfUrl).toContain("PMC6727618");
    expect(calls.some((c) => c.includes("api.unpaywall.org/v2/10.1021/"))).toBe(
      true,
    );
  });

  it("getPaper by arXiv id returns null when nothing is found", async () => {
    overrides["api.semanticscholar.org"] = () =>
      new Response("", { status: 404 });
    overrides["api.openalex.org"] = () => new Response("", { status: 404 });
    overrides["export.arxiv.org"] = () => ok("<feed></feed>");
    overrides["api.crossref.org"] = () => new Response("", { status: 404 });
    expect(await getPaper({ arxivId: "9999.99999" })).toBeNull();
    expect(await getPaper({})).toBeNull();
  });

  it("paperLinks uses Semantic Scholar citations", async () => {
    const data = (json("semantic_scholar.json") as { data: unknown[] }).data;
    overrides["api.semanticscholar.org"] = () =>
      ok(JSON.stringify({ data: data.map((p) => ({ citingPaper: p })) }));
    const links = await paperLinks({
      arxivId: GCN_ARXIV,
      direction: "citations",
      limit: 2,
    });
    expect(links).toHaveLength(2);
    expect(calls[0]).toContain("/paper/ARXIV:1609.02907/citations");
  });

  it("paperLinks falls back to OpenAlex when Semantic Scholar fails", async () => {
    overrides["api.semanticscholar.org"] = () =>
      new Response("", { status: 429 });
    overrides["api.openalex.org"] = (url) =>
      url.pathname.includes("/works/doi:")
        ? ok(
            JSON.stringify(
              (json("openalex.json") as { results: unknown[] }).results[2],
            ),
          )
        : null;
    const links = await paperLinks({
      doi: CHEMPROP_DOI,
      direction: "references",
      limit: 5,
    });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].foundBy).toEqual(["openalex"]);
    expect(calls.some((c) => c.includes("filter=cited_by%3AW"))).toBe(true);
  });

  it("paperLinks returns [] without an id or when everything fails", async () => {
    expect(await paperLinks({ direction: "citations" })).toEqual([]);
    overrides["api.semanticscholar.org"] = () =>
      new Response("", { status: 404 });
    overrides["api.openalex.org"] = () => new Response("", { status: 404 });
    expect(await paperLinks({ doi: "10.1/x", direction: "citations" })).toEqual(
      [],
    );
  });
});

describe("paper tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ctx = { projectPath: "", chatId: "c", messageId: "m", modelId: "x" };

  it("registers search_papers, get_paper, paper_links with a 7-day TTL", () => {
    const tools = createPaperTools({});
    expect(tools.map((t) => t.name)).toEqual([
      "search_papers",
      "get_paper",
      "paper_links",
    ]);
    for (const t of tools) {
      expect(t.provider).toBe("papers");
      expect(t.kind).toBe("read");
      expect(t.ttlSec).toBe(604800);
    }
  });

  it("validates inputs", () => {
    const [search, get, links] = createPaperTools({});
    expect(search.inputSchema.safeParse({ query: "" }).success).toBe(false);
    expect(
      search.inputSchema.safeParse({ query: "x", limit: 51 }).success,
    ).toBe(false);
    expect(
      search.inputSchema.safeParse({ query: "x", limit: 50 }).success,
    ).toBe(true);
    expect(get.inputSchema.safeParse({}).success).toBe(false);
    expect(get.inputSchema.safeParse({ doi: "10.1/abc" }).success).toBe(true);
    expect(
      links.inputSchema.safeParse({ doi: "10.1/abc", direction: "sideways" })
        .success,
    ).toBe(false);
  });

  it("search_papers returns sources, per-provider status and model text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const host = new URL(String(input)).hostname;
        if (host === "api.openalex.org") {
          return new Response(text("openalex.json"), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (host === "export.arxiv.org") {
          return new Response(text("arxiv.xml"), { status: 200 });
        }
        return new Response("nope", { status: 503 });
      }),
    );
    const [search] = createPaperTools({
      enabledProviders: ["openalex", "arxiv", "dblp"],
    });
    const res = await search.handler({ query: "gnn", limit: 5 }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.data as {
      papers: Paper[];
      providers: { provider: string; ok: boolean }[];
    };
    expect(data.providers).toHaveLength(3);
    expect(data.providers.find((p) => p.provider === "dblp")?.ok).toBe(false);
    expect(data.papers[0].foundBy).toEqual(
      expect.arrayContaining(["openalex", "arxiv"]),
    );
    expect(res.sources?.length).toBe(data.papers.length);
    expect(res.modelText).toContain("Searched 2 of 3 sources");
    expect(res.modelText).toContain("Failures: dblp");
  });

  it("search_papers fails cleanly when every provider fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { status: 500 })),
    );
    const [search] = createPaperTools({
      enabledProviders: ["openalex", "arxiv"],
    });
    const res = await search.handler({ query: "gnn" }, ctx);
    expect(res.ok).toBe(false);
  });

  it("get_paper reports not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    const get = createPaperTools({})[1];
    const out = await get.handler({ doi: "10.1/none" }, ctx);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("Paper not found");
    expect(out.data).toMatchObject({ paper: null });
    expect(Array.isArray((out.data as { attempts?: unknown }).attempts)).toBe(
      true,
    );
  });
});
