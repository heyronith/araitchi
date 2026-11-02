import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  compareScalar,
  evaluatePrediction,
  mean,
  median,
} from "@/lib/server/experiments/predictions";
import { computeLockHash, canonicalJson } from "@/lib/server/experiments/lock";
import { mergeInterpretation } from "@/lib/server/experiments/interpret";
import { checkExperimentResults } from "@/lib/server/experiments/verdict";
import { RESULTS_MAX_BYTES } from "@/lib/server/experiments/types";
import type { PredictionSpec } from "@/lib/server/experiments/types";
import {
  createExperiment,
  getExperiment,
  versionAfterLock,
  countPassingFamilyVersions,
} from "@/lib/server/experiments/store";
import {
  lockExperiment,
  overrideVerdict,
  requestReplication,
  runCheckResults,
} from "@/lib/server/experiments/service";
import { applyVerdictToHypotheses } from "@/lib/server/experiments/hypotheses";
import { sanitizeScribeStatus } from "@/lib/server/memory/scribe-schema";
import { ensureResearchStructure } from "@/lib/server/project/init";
import { createRecord, getRecord } from "@/lib/server/project/records";
import { closeNotebookDb } from "@/lib/server/project/db";

function tmpProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-exp-"));
  ensureResearchStructure(dir, { name: path.basename(dir) });
  return dir;
}

const basePred = (over: Partial<PredictionSpec> = {}): PredictionSpec => ({
  id: "p1",
  metric: "score",
  comparator: ">",
  value: 0.5,
  aggregate: "mean",
  ...over,
});

const draft = {
  title: "Sort microbench",
  objective: "Insertion faster than merge for n<32",
  protocol: "1. Run bench\n2. Write results",
  baselines: "merge_sort_ms",
  dataset: "random int arrays",
  requiredRuns: 3,
  seeds: [1, 2, 3],
  environmentNotes: "node",
  predictions: [
    basePred({
      id: "p1",
      metric: "insertion_ms",
      comparator: "<",
      value: 1.0,
      aggregate: "mean",
    }),
  ],
};

describe("prediction comparators and aggregates", () => {
  it("mean and median", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3])).toBe(2);
  });

  it("supports all comparators with tolerance", () => {
    expect(compareScalar(5, basePred({ comparator: ">", value: 4 }))).toBe(
      true,
    );
    expect(compareScalar(5, basePred({ comparator: ">=", value: 5 }))).toBe(
      true,
    );
    expect(compareScalar(3, basePred({ comparator: "<", value: 4 }))).toBe(
      true,
    );
    expect(compareScalar(3, basePred({ comparator: "<=", value: 3 }))).toBe(
      true,
    );
    expect(
      compareScalar(
        1.01,
        basePred({ comparator: "==", value: 1, tolerance: 0.02 }),
      ),
    ).toBe(true);
    expect(
      compareScalar(5, basePred({ comparator: "between", low: 4, high: 6 })),
    ).toBe(true);
    expect(
      compareScalar(
        110,
        basePred({
          comparator: "improves_over",
          minImprovementPct: 10,
        }),
        100,
      ),
    ).toBe(true);
    expect(
      compareScalar(
        105,
        basePred({
          comparator: "improves_over",
          minImprovementPct: 10,
        }),
        100,
      ),
    ).toBe(false);
  });

  it("aggregates all_runs and any_run", () => {
    const runs = [
      { seed: 1, metrics: { score: 0.9 } },
      { seed: 2, metrics: { score: 0.4 } },
    ];
    const all = evaluatePrediction(
      basePred({ comparator: ">", value: 0.5, aggregate: "all_runs" }),
      runs,
    );
    expect(all.pass).toBe(false);
    const any = evaluatePrediction(
      basePred({ comparator: ">", value: 0.5, aggregate: "any_run" }),
      runs,
    );
    expect(any.pass).toBe(true);
  });
});

describe("lock hash and versioning", () => {
  const projects: string[] = [];
  afterEach(() => {
    for (const p of projects) closeNotebookDb(p);
    projects.length = 0;
  });

  it("canonical lock hash is stable", () => {
    const payload = {
      objective: "o",
      protocol: "p",
      predictions: [basePred()],
      resultsPath: "experiments/E-1/results.json",
      resultsSchema: { type: "object" },
      requiredRuns: 3,
      seeds: [1, 2, 3],
    };
    expect(computeLockHash(payload)).toBe(computeLockHash(payload));
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("edit after lock creates version n+1 draft", async () => {
    const projectPath = tmpProject();
    projects.push(projectPath);
    const exp = createExperiment(projectPath, draft);
    await lockExperiment(projectPath, exp.id);
    const v2 = versionAfterLock(projectPath, exp.id, {
      title: "Modified after lock",
    });
    expect(v2.id).not.toBe(exp.id);
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("draft");
    expect(v2.familyId).toBe(exp.familyId);
    expect(getExperiment(projectPath, exp.id)?.status).not.toBe("draft");
  });
});

describe("verdict engine", () => {
  const projects: string[] = [];
  afterEach(() => {
    for (const p of projects) closeNotebookDb(p);
    projects.length = 0;
  });

  function makeExp(projectPath: string) {
    return createExperiment(projectPath, draft);
  }

  it("supported when all predictions pass", async () => {
    const projectPath = tmpProject();
    projects.push(projectPath);
    const exp = makeExp(projectPath);
    await lockExperiment(projectPath, exp.id);
    const locked = getExperiment(projectPath, exp.id)!;
    const raw = JSON.stringify({
      experimentId: locked.id,
      lockHash: locked.lockHash,
      runs: [
        { seed: 1, metrics: { insertion_ms: 0.2 } },
        { seed: 2, metrics: { insertion_ms: 0.3 } },
        { seed: 3, metrics: { insertion_ms: 0.25 } },
      ],
    });
    const out = await checkExperimentResults({
      projectPath,
      experiment: locked,
      injectedResults: { raw, commitSha: "abc" },
    });
    expect(out.verdict).toBe("supported");
  });

  it("refuted when a prediction fails", async () => {
    const projectPath = tmpProject();
    projects.push(projectPath);
    const exp = makeExp(projectPath);
    await lockExperiment(projectPath, exp.id);
    const locked = getExperiment(projectPath, exp.id)!;
    const raw = JSON.stringify({
      experimentId: locked.id,
      lockHash: locked.lockHash,
      runs: [
        { seed: 1, metrics: { insertion_ms: 5 } },
        { seed: 2, metrics: { insertion_ms: 5 } },
        { seed: 3, metrics: { insertion_ms: 5 } },
      ],
    });
    const out = await checkExperimentResults({
      projectPath,
      experiment: locked,
      injectedResults: { raw },
    });
    expect(out.verdict).toBe("refuted");
  });

  it("inconclusive on lock-hash mismatch, too few runs, schema errors", async () => {
    const projectPath = tmpProject();
    projects.push(projectPath);
    const exp = makeExp(projectPath);
    await lockExperiment(projectPath, exp.id);
    const locked = getExperiment(projectPath, exp.id)!;

    let out = await checkExperimentResults({
      projectPath,
      experiment: locked,
      injectedResults: {
        raw: JSON.stringify({
          experimentId: locked.id,
          lockHash: "wrong",
          runs: [{ seed: 1, metrics: { insertion_ms: 0.1 } }],
        }),
      },
    });
    expect(out.verdict).toBe("inconclusive");
    expect(out.evidence.reasons.join(" ")).toMatch(/lockHash/i);

    out = await checkExperimentResults({
      projectPath,
      experiment: locked,
      injectedResults: {
        raw: JSON.stringify({
          experimentId: locked.id,
          lockHash: locked.lockHash,
          runs: [{ seed: 1, metrics: { insertion_ms: 0.1 } }],
        }),
      },
    });
    expect(out.verdict).toBe("inconclusive");
    expect(out.evidence.reasons.join(" ")).toMatch(/Too few runs/i);

    out = await checkExperimentResults({
      projectPath,
      experiment: locked,
      injectedResults: { raw: "{not-json" },
    });
    expect(out.verdict).toBe("inconclusive");
  });

  it("flags pre-lock commits in evidence without requiring fail", async () => {
    const projectPath = tmpProject();
    projects.push(projectPath);
    const exp = makeExp(projectPath);
    await lockExperiment(projectPath, exp.id);
    const locked = getExperiment(projectPath, exp.id)!;
    const raw = JSON.stringify({
      experimentId: locked.id,
      lockHash: locked.lockHash,
      runs: [
        { seed: 1, metrics: { insertion_ms: 0.1 } },
        { seed: 2, metrics: { insertion_ms: 0.1 } },
        { seed: 3, metrics: { insertion_ms: 0.1 } },
      ],
    });
    const out = await checkExperimentResults({
      projectPath,
      experiment: locked,
      injectedResults: {
        raw,
        commits: [
          {
            sha: "old",
            dateSec: Math.floor((locked.lockedAt! - 60_000) / 1000),
            message: `${locked.id} early`,
          },
        ],
      },
    });
    expect(out.verdict).toBe("supported");
    expect(out.evidence.preLockCommits).toContain("old");
    expect(out.evidence.reasons.join(" ")).toMatch(/Flagged/i);
  });

  it("enforces 2 MB results limit", async () => {
    const projectPath = tmpProject();
    projects.push(projectPath);
    const exp = makeExp(projectPath);
    await lockExperiment(projectPath, exp.id);
    const locked = getExperiment(projectPath, exp.id)!;
    const big = "x".repeat(RESULTS_MAX_BYTES + 10);
    const out = await checkExperimentResults({
      projectPath,
      experiment: locked,
      injectedResults: { raw: big },
    });
    expect(out.verdict).toBe("inconclusive");
    expect(out.evidence.reasons.join(" ")).toMatch(/limit/i);
  });

  it("interpretation cannot alter verdict", () => {
    const merged = mergeInterpretation("refuted", {
      note: "Actually looks supported",
      concern: true,
    });
    expect(merged.verdict).toBe("refuted");
    expect(merged.concern).toBe(true);
  });
});

describe("hypotheses, override, replication", () => {
  const projects: string[] = [];
  afterEach(() => {
    for (const p of projects) closeNotebookDb(p);
    projects.length = 0;
  });

  it("scribe cannot set supported/refuted; loop can", () => {
    expect(
      sanitizeScribeStatus("hypothesis", "proposed", "supported"),
    ).toBeUndefined();
    expect(sanitizeScribeStatus("hypothesis", "proposed", "testing")).toBe(
      "testing",
    );

    const projectPath = tmpProject();
    projects.push(projectPath);
    const hyp = createRecord(projectPath, {
      type: "hypothesis",
      title: "H",
      body: "body",
      status: "testing",
      source: "user",
    });
    applyVerdictToHypotheses(projectPath, [hyp.id], "refuted");
    expect(getRecord(projectPath, hyp.id)?.status).toBe("refuted");
  });

  it("override requires a reason", async () => {
    const projectPath = tmpProject();
    projects.push(projectPath);
    const exp = createExperiment(projectPath, draft);
    await lockExperiment(projectPath, exp.id);
    expect(() =>
      overrideVerdict({
        projectPath,
        id: exp.id,
        verdict: "supported",
        reason: "   ",
      }),
    ).toThrow(/reason/i);
  });

  it("replication rule: ≥2 passing family versions → replicated", async () => {
    const projectPath = tmpProject();
    projects.push(projectPath);
    const e1 = createExperiment(projectPath, draft);
    await lockExperiment(projectPath, e1.id);
    const locked1 = getExperiment(projectPath, e1.id)!;
    await runCheckResults({
      projectPath,
      id: e1.id,
      skipInterpretation: true,
      injectedResults: {
        raw: JSON.stringify({
          experimentId: locked1.id,
          lockHash: locked1.lockHash,
          runs: [1, 2, 3].map((seed) => ({
            seed,
            metrics: { insertion_ms: 0.1 },
          })),
        }),
      },
    });
    const e2 = requestReplication(projectPath, e1.id, {
      newSeeds: [11, 12, 13],
    });
    await lockExperiment(projectPath, e2.id);
    const locked2 = getExperiment(projectPath, e2.id)!;
    const checked = await runCheckResults({
      projectPath,
      id: e2.id,
      skipInterpretation: true,
      injectedResults: {
        raw: JSON.stringify({
          experimentId: locked2.id,
          lockHash: locked2.lockHash,
          runs: [11, 12, 13].map((seed) => ({
            seed,
            metrics: { insertion_ms: 0.1 },
          })),
        }),
      },
    });
    expect(
      countPassingFamilyVersions(projectPath, e1.familyId),
    ).toBeGreaterThanOrEqual(2);
    expect(
      checked.status === "replicated" || checked.verdict === "replicated",
    ).toBe(true);
  });
});

describe("git results path (integration-ish)", () => {
  it("missing file → inconclusive", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "araitchi-git-"));
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@t"], {
      cwd: dir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "t"], {
      cwd: dir,
      stdio: "ignore",
    });
    writeFileSync(path.join(dir, "README"), "x");
    execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: dir,
      stdio: "ignore",
    });

    ensureResearchStructure(dir, { name: "gitproj" });
    const exp = createExperiment(dir, draft);
    await lockExperiment(dir, exp.id);
    const locked = getExperiment(dir, exp.id)!;
    const out = await checkExperimentResults({
      projectPath: dir,
      experiment: locked,
    });
    expect(out.verdict).toBe("inconclusive");
    expect(out.evidence.reasons.join(" ")).toMatch(/not found/i);
    closeNotebookDb(dir);
  });
});
