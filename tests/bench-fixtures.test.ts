import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { validateBenchFixturesOffline } from "@/lib/server/bench/validate-fixtures";
import { checkExperimentResults } from "@/lib/server/experiments/verdict";
import type { ExperimentRow } from "@/lib/server/experiments/types";

describe("bench fixture offline validation", () => {
  it("passes schema/duplicates/source checks", () => {
    const v = validateBenchFixturesOffline(process.cwd());
    if (!v.ok) console.error(v.issues.slice(0, 25));
    expect(v.ok).toBe(true);
    expect(v.counts["1"]).toBe(40);
    expect(v.counts["2"]).toBe(30);
    expect(v.counts["3"]).toBe(15);
    expect(v.counts["4"]).toBe(10);
  });
});

describe("config D correctness from verdict engine", () => {
  it("supported fixture matches expectedVerdict via checkExperimentResults", async () => {
    const items = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "evals/bench/validation/items.json"),
        "utf8",
      ),
    ) as Record<string, unknown>[];
    const item = items.find((i) => i.expectedVerdict === "supported")!;
    expect(item).toBeTruthy();
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), String(item.resultsFile)), "utf8"),
    ) as {
      lockHash: string;
      runs: { seed: number; metrics: Record<string, number> }[];
    };
    const id = "bench-test";
    const lockHash = raw.lockHash || "lock";
    const predictions = item.predictions as ExperimentRow["predictions"];
    const exp = {
      id,
      familyId: "fam",
      version: 1,
      hypothesisIds: [],
      title: "bench",
      objective: "o",
      protocol: "p",
      baselines: "",
      dataset: "",
      requiredRuns: Number(item.requiredRuns) || raw.runs.length,
      seeds: (item.seeds as number[]) || raw.runs.map((r) => r.seed),
      environmentNotes: "",
      predictions,
      resultsPath: `experiments/${id}/results.json`,
      resultsSchema: {},
      status: "awaiting_run" as const,
      lockedAt: Date.now(),
      lockHash,
      lockRepoHead: null,
      verdict: null,
      verdictEvidence: null,
      interpretation: null,
      interpretationConcern: false,
      overrideVerdict: null,
      overrideReason: null,
      overrideAt: null,
      replicationOf: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies ExperimentRow;

    const { verdict } = await checkExperimentResults({
      projectPath: process.cwd(),
      experiment: exp,
      injectedResults: {
        raw: JSON.stringify({
          experimentId: id,
          lockHash,
          runs: raw.runs,
        }),
      },
    });
    expect(verdict).toBe(String(item.expectedVerdict));
  });
});
