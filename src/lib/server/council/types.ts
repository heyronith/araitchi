import { z } from "zod";

export const councilAnalysisSchema = z.object({
  finalAnswer: z.string().min(1),
  consensus: z.array(z.string()),
  contradictions: z.array(
    z.object({
      topic: z.string(),
      positions: z.array(
        z.object({
          member: z.string(),
          stance: z.string(),
        }),
      ),
      needsEvidence: z.boolean(),
    }),
  ),
  uniqueInsights: z.array(
    z.object({
      member: z.string(),
      insight: z.string(),
    }),
  ),
  blindSpots: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
});

export type CouncilAnalysis = z.infer<typeof councilAnalysisSchema>;

export type CouncilConfig = {
  members: string[];
  synthesizer: string;
  maxOutputTokensPerMember: number;
  budgetCapUsd: number;
  memberTimeoutSec: number;
  preset: "balanced" | "budget" | "custom";
};

export type ChatMode = "solo" | "council";

export type MemberResultStatus =
  "done" | "failed" | "substituted" | "streaming" | "pending";

export type CouncilMemberResult = {
  modelId: string;
  content: string;
  status: MemberResultStatus;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
  } | null;
  cost: number | null;
  latencyMs: number;
  substitutedFrom?: string | null;
  error?: string | null;
  lab?: string;
};

export type CouncilSummary = {
  membersOk: number;
  membersFailed: number;
  totalCost: number;
  totalTimeMs: number;
  confidence?: "low" | "medium" | "high";
};

export type MemberStreamEvent = {
  phase: "start" | "delta" | "finish" | "error" | "substituted";
  modelId: string;
  lab?: string;
  text?: string;
  content?: string;
  usage?: { inputTokens?: number; outputTokens?: number } | null;
  cost?: number | null;
  latencyMs?: number;
  substitutedFrom?: string | null;
  error?: string | null;
};

export type SynthesisStreamEvent = {
  phase: "delta" | "final";
  text: string;
};

export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  members: [],
  synthesizer: "",
  maxOutputTokensPerMember: 2000,
  budgetCapUsd: 0.5,
  memberTimeoutSec: 120,
  preset: "balanced",
};

/** Continue synthesis when at least 2 members succeeded. */
export function councilHasEnoughMembers(okCount: number): boolean {
  return okCount >= 2;
}
