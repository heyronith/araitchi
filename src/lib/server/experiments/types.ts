import { z } from "zod";

export const PREDICTION_COMPARATORS = [
  ">",
  ">=",
  "<",
  "<=",
  "==",
  "between",
  "improves_over",
] as const;

export const PREDICTION_AGGREGATES = [
  "mean",
  "median",
  "all_runs",
  "any_run",
] as const;

export const predictionSpecSchema = z
  .object({
    id: z.string().min(1).max(64),
    metric: z.string().min(1).max(120),
    comparator: z.enum(PREDICTION_COMPARATORS),
    value: z.number().optional(),
    tolerance: z.number().nonnegative().optional(),
    low: z.number().optional(),
    high: z.number().optional(),
    baseline: z.object({ metric: z.string().min(1).max(120) }).optional(),
    minImprovementPct: z.number().optional(),
    aggregate: z.enum(PREDICTION_AGGREGATES).default("mean"),
  })
  .superRefine((p, ctx) => {
    if (p.comparator === "between") {
      if (typeof p.low !== "number" || typeof p.high !== "number") {
        ctx.addIssue({
          code: "custom",
          message: "between requires low and high",
        });
      }
    } else if (p.comparator === "improves_over") {
      if (!p.baseline?.metric) {
        ctx.addIssue({
          code: "custom",
          message: "improves_over requires baseline.metric",
        });
      }
    } else if (typeof p.value !== "number") {
      ctx.addIssue({
        code: "custom",
        message: `${p.comparator} requires value`,
      });
    }
  });

export type PredictionSpec = z.infer<typeof predictionSpecSchema>;

export const EXPERIMENT_STATUSES = [
  "draft",
  "locked",
  "awaiting_run",
  "checking",
  "supported",
  "refuted",
  "inconclusive",
  "replicated",
] as const;

export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const VERDICTS = [
  "supported",
  "refuted",
  "inconclusive",
  "replicated",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const experimentDraftSchema = z.object({
  title: z.string().min(1).max(300),
  objective: z.string().min(1).max(8000),
  protocol: z.string().min(1).max(20_000),
  baselines: z.string().max(8000).default(""),
  dataset: z.string().max(8000).default(""),
  requiredRuns: z.number().int().min(1).max(100).default(3),
  seeds: z.array(z.number().int()).min(1).max(100),
  environmentNotes: z.string().max(4000).default(""),
  predictions: z.array(predictionSpecSchema).min(1).max(40),
  resultsPath: z.string().min(1).max(400).optional(),
});

export type ExperimentDraft = z.infer<typeof experimentDraftSchema>;

export type PredictionEval = {
  predictionId: string;
  metric: string;
  observed: number | number[] | null;
  expected: string;
  pass: boolean | null;
  detail: string;
};

export type VerdictEvidence = {
  commitSha: string | null;
  filePath: string;
  reasons: string[];
  predictions: PredictionEval[];
  preLockCommits: string[];
  runCount: number;
  requiredRuns: number;
  checkedAt: number;
};

export type ExperimentRow = {
  id: string;
  familyId: string;
  version: number;
  hypothesisIds: string[];
  title: string;
  objective: string;
  protocol: string;
  baselines: string;
  dataset: string;
  requiredRuns: number;
  seeds: number[];
  environmentNotes: string;
  predictions: PredictionSpec[];
  resultsPath: string;
  resultsSchema: Record<string, unknown>;
  status: ExperimentStatus;
  lockedAt: number | null;
  lockHash: string | null;
  lockRepoHead: string | null;
  verdict: Verdict | null;
  verdictEvidence: VerdictEvidence | null;
  interpretation: string | null;
  interpretationConcern: boolean;
  overrideVerdict: Verdict | null;
  overrideReason: string | null;
  overrideAt: number | null;
  replicationOf: string | null;
  createdAt: number;
  updatedAt: number;
};

export const RESULTS_MAX_BYTES = 2 * 1024 * 1024;

export const resultsFileSchema = z.object({
  experimentId: z.string().min(1),
  lockHash: z.string().min(1),
  commit: z.string().optional(),
  runs: z
    .array(
      z.object({
        seed: z.number(),
        metrics: z.record(z.string(), z.number()),
      }),
    )
    .min(1),
  env: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
});

export type ResultsFile = z.infer<typeof resultsFileSchema>;
