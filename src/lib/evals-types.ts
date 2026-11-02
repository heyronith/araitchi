/** Shared eval / bench report types (safe for client + server). */

export type BenchConfigId = "A" | "B" | "C" | "D";
export type BenchSetId = "1" | "2" | "3" | "4";

export type BenchTableRow = {
  meanScore: number;
  ciLow: number;
  ciHigh: number;
  meanCost: number;
  costPerCorrect: number;
  meanLatencyMs: number;
  n: number;
};

export type BenchItemResult = {
  set: BenchSetId;
  config: BenchConfigId;
  itemId: string;
  correct: boolean;
  score: number;
  costUsd: number;
  latencyMs: number;
  borderline?: boolean;
  detail?: string;
  gateAction?: string;
};

export type BenchReport = {
  generatedAt: string;
  options: {
    sets: BenchSetId[];
    configs: BenchConfigId[];
    limit?: number;
    repeats?: number;
    budgetCapUsd?: number;
    dryRun?: boolean;
  };
  items: BenchItemResult[];
  tables: Record<string, BenchTableRow>;
  findings: string[];
};

export type EvalDoc = {
  name: string;
  markdown: string | null;
  json: unknown | null;
};

export type EvalsApiResponse = {
  bench: BenchReport | null;
  benchSource: "dated" | "fixture" | null;
  benchPath: string | null;
  fixture: BenchReport | null;
  docs: EvalDoc[];
};
