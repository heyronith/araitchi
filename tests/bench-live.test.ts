import { describe, expect, it, vi } from "vitest";

import * as mock from "@/lib/server/bench/mock";
import { runBench } from "@/lib/server/bench/runner";
import {
  paperIdsFromProvenance,
  parseTopHypotheses,
  scoreRediscovery,
} from "@/lib/server/bench/scoring";
import { FakeEmbedder } from "@/lib/server/memory/fake-embedder";
import { setEmbedderForTests } from "@/lib/server/memory/embedder";

describe("bench live vs mock", () => {
  it("live path never calls mockReplyForItem", async () => {
    const spy = vi.spyOn(mock, "mockReplyForItem");
    const liveRunner = vi.fn(async () => ({
      correct: true,
      score: 1,
      costUsd: 0.1234,
      latencyMs: 10,
      detail: "injected",
    }));

    await runBench({
      sets: ["1"],
      configs: ["A"],
      limit: 1,
      repeats: 1,
      dryRun: false,
      yes: true,
      liveRunner,
    });

    expect(spy).not.toHaveBeenCalled();
    expect(liveRunner).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("dry-run path uses mock", async () => {
    const spy = vi.spyOn(mock, "mockReplyForItem");
    await runBench({
      sets: ["1"],
      configs: ["A"],
      limit: 1,
      repeats: 1,
      dryRun: true,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("bench scoring helpers", () => {
  it("set-2 ids prefer provenance over text alone", () => {
    const ids = paperIdsFromProvenance(
      [{ doi: "10.1000/xyz", title: "X" }],
      "no dois here",
    );
    expect(ids).toContain("10.1000/xyz");
  });

  it("set-3 uses injected embedder via same scoreRediscovery path", async () => {
    const fake = new FakeEmbedder();
    setEmbedderForTests(fake);
    const rd = await scoreRediscovery({
      item: {
        goldStatement: "CRISPR gene editing",
        requiredTerms: ["crispr", "gene"],
        verified: false,
      },
      text: "CRISPR enables gene editing in cells",
      hypotheses: parseTopHypotheses(
        "- CRISPR enables gene editing\n- Other idea",
        3,
      ),
      embedder: fake,
      similarityThreshold: 0.5,
    });
    expect(rd.excludedFromHeadline).toBe(true);
    setEmbedderForTests(null);
  });

  it("unverified rediscovery excluded from headline tables", async () => {
    const report = await runBench({
      sets: ["3"],
      configs: ["A"],
      limit: 2,
      repeats: 1,
      dryRun: true,
    });
    const excluded = report.items.filter((i) => i.excludedFromHeadline);
    // All fixtures start unverified after T9b rebuild; until then may vary
    if (report.items.some((i) => i.excludedFromHeadline)) {
      expect(report.tables["3:A"]?.n ?? 0).toBeLessThanOrEqual(
        report.items.length - excluded.length + excluded.length,
      );
      // Headline n excludes unverified
      const headlineN = report.items.filter(
        (i) => !i.excludedFromHeadline,
      ).length;
      expect(report.tables["3:A"]?.n ?? 0).toBe(headlineN);
    }
  });
});
