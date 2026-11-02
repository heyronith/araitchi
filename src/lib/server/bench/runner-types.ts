export type BenchConfigId = "A" | "B" | "C" | "D";
export type BenchSetId = "1" | "2" | "3" | "4";

export type BenchOptions = {
  sets: BenchSetId[];
  configs: BenchConfigId[];
  limit?: number;
  repeats?: number;
  budgetCapUsd?: number;
  /** Stop after cumulative spend exceeds this (live runs; partial report). */
  maxSpendUsd?: number;
  dryRun?: boolean;
  /** Skip interactive cost confirmation for live runs. */
  yes?: boolean;
  root?: string;
  /**
   * Test seam: inject live pipeline. Production uses `./live`.
   * When dryRun is false and this is omitted, live.ts is loaded.
   */
  liveRunner?: typeof import("./live").runLiveItem;
};

export type ItemResult = {
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
  /** Set 3: item not yet human-verified — excluded from headline tables. */
  excludedFromHeadline?: boolean;
};

export type BenchReport = {
  generatedAt: string;
  options: BenchOptions;
  items: ItemResult[];
  tables: Record<
    string,
    {
      meanScore: number;
      ciLow: number;
      ciHigh: number;
      meanCost: number;
      costPerCorrect: number;
      meanLatencyMs: number;
      n: number;
    }
  >;
  findings: string[];
  /** Rediscovery items awaiting owner review. */
  unverifiedRediscovery?: Array<{ id: string; goldStatement?: string }>;
};
