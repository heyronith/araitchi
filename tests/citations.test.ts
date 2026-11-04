import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  checkCitations,
  citationsBlockMemorySave,
  formatMemberCitationBrief,
} from "@/lib/server/citations/check";
import { extractCitations } from "@/lib/server/citations/extract";
import {
  firstAuthorMatches,
  titleSimilarity,
  yearMatches,
  TITLE_MATCH_THRESHOLD,
} from "@/lib/server/citations/match";
import { resolveCitation } from "@/lib/server/citations/resolve";
import {
  checkClaimSupportDetailed,
  heuristicSupport,
} from "@/lib/server/citations/support";
import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";
import {
  createBrokerForRequest,
  resetToolRateLimitersForTests,
} from "@/lib/server/tools/broker";
import type { RegisteredTool } from "@/lib/server/tools/types";
import type { Paper } from "@/lib/server/tools/papers/types";
import { wrapUntrustedToolResult } from "@/lib/server/tools/untrusted";
import { wilsonCi } from "@/lib/server/evals/citation-scorer";

afterEach(() => {
  closeAllNotebookDbs();
  resetToolRateLimitersForTests();
});

const realPaper: Paper = {
  title: "Attention Is All You Need",
  authors: ["Ashish Vaswani", "Noam Shazeer"],
  year: 2017,
  venue: "NeurIPS",
  abstract:
    "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
  doi: "10.5555/3295222.3295349",
  arxivId: "1706.03762",
  url: null,
  pdfUrl: null,
  citationCount: 100000,
  foundBy: ["crossref"],
};

describe("citation extraction", () => {
  it("does not treat years inside DOI paths as asserted metadata", () => {
    const cites = extractCitations(
      "According to doi:10.1109/cvpr.2015.7298965 the prior work is relevant.",
    );
    const doi = cites.find((c) => c.kind === "doi");
    expect(doi?.doi).toContain("10.1109/cvpr.2015");
    expect(doi?.year).toBeUndefined();
    expect(doi?.title).toBeUndefined();
  });

  it("extracts DOI, arXiv, URL, and free-text", () => {
    const text = [
      "See doi:10.5555/3295222.3295349 for the Transformer.",
      "Also arxiv:1706.03762 and https://arxiv.org/abs/1706.03762.",
      'Vaswani et al., 2017, "Attention Is All You Need" introduced self-attention.',
    ].join(" ");
    const cites = extractCitations(text);
    expect(
      cites.some((c) => c.kind === "doi" && c.doi?.includes("10.5555")),
    ).toBe(true);
    expect(
      cites.some((c) => c.kind === "arxiv" && c.arxivId === "1706.03762"),
    ).toBe(true);
    expect(cites.some((c) => c.kind === "url")).toBe(true);
    expect(cites.some((c) => c.kind === "free_text" && c.year === 2017)).toBe(
      true,
    );
  });
});

describe("metadata matching", () => {
  it("title similarity threshold and year/author", () => {
    expect(
      titleSimilarity("Attention Is All You Need", "Attention Is All You Need"),
    ).toBeGreaterThanOrEqual(TITLE_MATCH_THRESHOLD);
    expect(yearMatches(2017, 2017)).toBe(true);
    expect(yearMatches(2017, 2018)).toBe(true);
    expect(yearMatches(2017, 2020)).toBe(false);
    expect(firstAuthorMatches("Vaswani", realPaper.authors)).toBe(true);
    expect(firstAuthorMatches("Smith", realPaper.authors)).toBe(false);
  });
});

describe("checkCitations status assignment", () => {
  it("marks not_found, mismatch, verified, claim_not_supported", async () => {
    const papers = new Map<string, Paper | null>([
      ["10.9999/fake.doi.never", null],
      [
        "10.5555/3295222.3295349",
        {
          ...realPaper,
          title: "Completely Different Paper About Cats",
          year: 1999,
          authors: ["Someone Else"],
        },
      ],
      ["1706.03762", realPaper],
    ]);

    const resolveOverride = (c: {
      doi?: string;
      arxivId?: string;
      title?: string;
    }) => {
      if (c.doi && papers.has(c.doi)) return papers.get(c.doi)!;
      if (c.arxivId && papers.has(c.arxivId)) return papers.get(c.arxivId)!;
      if (c.title?.includes("Attention")) return realPaper;
      return null;
    };

    const notFound = await checkCitations("Fake doi:10.9999/fake.doi.never.", {
      resolveOverride,
      skipSupport: true,
    });
    expect(notFound.not_found).toBe(1);

    // Free-text asserts a title/year that do not match the resolved paper.
    const mismatch = await checkCitations(
      'Smith et al., 2020, "A Paper About Unicorns in Gradient Descent" is foundational.',
      {
        resolveOverride: () => realPaper,
        skipSupport: true,
      },
    );
    expect(mismatch.metadata_mismatch).toBeGreaterThanOrEqual(1);

    const verified = await checkCitations("See arxiv:1706.03762.", {
      resolveOverride,
      skipSupport: true,
    });
    expect(verified.verified).toBe(1);

    const unsupported = await checkCitations(
      "arxiv:1706.03762 proves that cats invented calculus in 1800.",
      {
        resolveOverride: () => realPaper,
        skipSupport: false,
        checkWithModel: async () => "not_supported",
      },
    );
    expect(unsupported.claim_not_supported).toBe(1);
  });

  it("formats member briefs for synthesizer and blocks memory save", async () => {
    const summary = await checkCitations("doi:10.9999/nope", {
      resolveOverride: () => null,
      skipSupport: true,
    });
    const brief = formatMemberCitationBrief("Member A", summary);
    expect(brief).toContain("not_found");
    expect(brief).toContain("Do not rely");
    expect(citationsBlockMemorySave(summary)).toBe(true);
  });
});

describe("support check", () => {
  it("uses model inject path and wraps abstract as untrusted", async () => {
    let sawUntrusted = false;
    const verdict = await checkClaimSupportDetailed(
      "Transformers use self-attention",
      realPaper,
      {
        checkWithModel: async ({ abstract }) => {
          const wrapped = wrapUntrustedToolResult(
            "paper_abstract",
            "citation_support",
            abstract,
          );
          sawUntrusted = wrapped.includes("untrusted");
          return { verdict: "supported", reason: "matches" };
        },
      },
    );
    expect(verdict.verdict).toBe("supported");
    expect(verdict.via).toBe("inject");
    expect(sawUntrusted).toBe(true);
  });

  it("falls back to heuristic offline", () => {
    const ok = heuristicSupport(
      "Transformer based solely on attention mechanisms",
      realPaper.abstract!,
    );
    expect(["supported", "unclear", "not_supported"]).toContain(ok.verdict);
    expect(ok.via).toBe("heuristic");
  });
});

describe("citation resolve via tool broker", () => {
  it("resolving the same citation twice makes one network call", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "araitchi-cite-broker-"));
    mkdirSync(dir, { recursive: true });
    ensureResearchStructure(dir, { name: "cite-broker" });
    writeFileSync(path.join(dir, "README.md"), "x");

    const broker = createBrokerForRequest({
      projectPath: dir,
      chatId: "c1",
      messageId: "m1",
    });
    let networkCalls = 0;
    const getPaper: RegisteredTool = {
      name: "get_paper",
      description: "get",
      inputSchema: z.object({
        doi: z.string().optional(),
        arxivId: z.string().optional(),
      }),
      kind: "read",
      provider: "papers",
      ttlSec: 3600,
      handler: async () => {
        networkCalls += 1;
        return { ok: true, data: { paper: realPaper } };
      },
    };
    broker.register(getPaper);

    const cit = {
      id: "c1",
      kind: "doi" as const,
      raw: "doi:10.5555/3295222.3295349",
      doi: "10.5555/3295222.3295349",
      claim: "See the paper.",
      index: 0,
    };
    const a = await resolveCitation(cit, { broker });
    const b = await resolveCitation(cit, { broker });
    expect(a?.title).toBe(realPaper.title);
    expect(b?.title).toBe(realPaper.title);
    expect(networkCalls).toBe(1);
  });
});

describe("wilson CI", () => {
  it("returns a sensible interval", () => {
    const [lo, hi] = wilsonCi(95, 100);
    expect(lo).toBeGreaterThan(0.8);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("inconclusive resolution → unchecked", () => {
  it("simulated 429 never becomes not_found", async () => {
    const summary = await checkCitations("See doi:10.9999/rate.limited.doi.", {
      resolveOverride: () => ({
        paper: null,
        outcome: {
          kind: "unchecked",
          reason: "Inconclusive resolution: openalex:rate_limited",
          attempts: [
            {
              provider: "openalex",
              answered: false,
              error: "rate_limited",
            },
            {
              provider: "crossref",
              answered: false,
              error: "HTTP 429",
            },
          ],
        },
      }),
      skipSupport: true,
    });
    expect(summary.unchecked).toBe(1);
    expect(summary.not_found).toBe(0);
    expect(summary.results[0]?.status).toBe("unchecked");
  });

  it("simulated timeout never becomes not_found", async () => {
    const summary = await checkCitations("See arxiv:9999.99999.", {
      resolveOverride: () => ({
        paper: null,
        outcome: {
          kind: "unchecked",
          reason: "Inconclusive resolution: get_paper timed out",
          attempts: [
            {
              provider: "arxiv",
              answered: false,
              error: "timeout",
            },
          ],
        },
      }),
      skipSupport: true,
    });
    expect(summary.results[0]?.status).toBe("unchecked");
    expect(summary.not_found).toBe(0);
  });

  it("confident miss (≥2 answered) stays not_found", async () => {
    const summary = await checkCitations("See doi:10.9999/really.missing.", {
      resolveOverride: () => ({
        paper: null,
        outcome: {
          kind: "not_found",
          reason: "2 providers answered; none found the work",
          attempts: [
            { provider: "crossref", answered: true },
            { provider: "openalex", answered: true },
          ],
        },
      }),
      skipSupport: true,
    });
    expect(summary.not_found).toBe(1);
    expect(summary.unchecked).toBe(0);
  });
});

describe("classifyMiss", () => {
  it("requires two answered providers for not_found", async () => {
    const { classifyMiss } =
      await import("@/lib/server/citations/resolve-outcome");
    expect(
      classifyMiss([
        { provider: "crossref", answered: false, error: "rate_limited" },
        { provider: "openalex", answered: false, error: "HTTP 503" },
      ]).kind,
    ).toBe("unchecked");
    expect(
      classifyMiss([
        { provider: "crossref", answered: true },
        { provider: "openalex", answered: true },
      ]).kind,
    ).toBe("not_found");
  });
});
