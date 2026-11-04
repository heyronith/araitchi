import { describe, expect, it } from "vitest";

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
import type { Paper } from "@/lib/server/tools/papers/types";

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
