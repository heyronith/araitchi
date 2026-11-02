import { describe, expect, it } from "vitest";

import {
  bootstrapMeanCi,
  checkDate,
  checkDoi,
  checkExactEntity,
  checkNumeric,
  normalizeDoi,
  precisionOfCitations,
  recallAtK,
  rediscoveryHit,
} from "@/lib/server/bench/checkers";
import {
  getBenchContext,
  setBenchContext,
  withBenchContext,
} from "@/lib/server/bench/context";
import { loadDefaults, resetDefaultsCache } from "@/lib/server/defaults";
import { resolveBenchYearTo } from "@/lib/server/tools/papers/search";

describe("bench checkers", () => {
  it("numeric tolerance", () => {
    expect(checkNumeric("3.14", 3.1415, 0.01)).toBe(true);
    expect(checkNumeric("3.14", 3.1415, 0.0001)).toBe(false);
  });

  it("DOI normalisation", () => {
    expect(normalizeDoi("https://doi.org/10.1000/XYZ")).toBe("10.1000/xyz");
    expect(checkDoi("doi:10.1000/Abc", "10.1000/abc")).toBe(true);
  });

  it("exact entity and date", () => {
    expect(checkExactEntity("  Alpha Beta ", "alpha beta")).toBe(true);
    expect(checkDate("2020-01-15T12:00:00Z", "2020-01-15")).toBe(true);
  });

  it("recall@k and citation precision", () => {
    const gold = ["10.1000/a", "10.1000/b", "10.1000/c"];
    const pred = ["10.1000/a", "10.1000/x", "10.1000/b"];
    expect(recallAtK(pred, gold, 20)).toBeCloseTo(2 / 3);
    const resolvable = new Set(["10.1000/a", "10.1000/b"]);
    expect(precisionOfCitations(pred, resolvable)).toBeCloseTo(2 / 3);
  });

  it("rediscovery rubric", () => {
    const hit = rediscoveryHit({
      hypotheses: ["CRISPR Cas9 gene editing in human cells"],
      requiredTerms: ["crispr", "cas9", "gene"],
      goldStatement: "CRISPR-Cas9 enables gene editing",
      similarity: 0.8,
      similarityThreshold: 0.72,
    });
    expect(hit.hit).toBe(true);
  });

  it("bootstrap mean CI", () => {
    const samples = [1, 1, 1, 1, 0, 1, 1, 0, 1, 1];
    const ci = bootstrapMeanCi(samples, { iterations: 500, seed: 1 });
    expect(ci.mean).toBeGreaterThan(0.5);
    expect(ci.low).toBeLessThanOrEqual(ci.mean);
    expect(ci.high).toBeGreaterThanOrEqual(ci.mean);
  });
});

describe("defaults loader", () => {
  it("loads config/defaults.json", () => {
    resetDefaultsCache();
    const d = loadDefaults(true);
    expect(d.scribeModel).toBeTruthy();
    expect(d.probeModels).toHaveLength(2);
    expect(d.bench.budgetCapUsd).toBeGreaterThan(0);
  });
});

describe("bench yearTo cutoff", () => {
  it("exposes yearTo via bench context for paper search", async () => {
    setBenchContext({ yearTo: 2018, dryRun: true });
    expect(getBenchContext()?.yearTo).toBe(2018);

    await withBenchContext({ yearTo: 2015 }, async () => {
      expect(getBenchContext()?.yearTo).toBe(2015);
    });
    expect(getBenchContext()?.yearTo).toBe(2018);
    setBenchContext(null);
    expect(getBenchContext()).toBeNull();
  });

  it("resolveBenchYearTo never exceeds bench ceiling", () => {
    expect(resolveBenchYearTo(undefined, 2018)).toBe(2018);
    expect(resolveBenchYearTo(2020, 2018)).toBe(2018);
    expect(resolveBenchYearTo(2015, 2018)).toBe(2015);
    expect(resolveBenchYearTo(2020, undefined)).toBe(2020);
  });
});
