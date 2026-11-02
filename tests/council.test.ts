import { describe, expect, it, vi } from "vitest";

import {
  extractJsonObject,
  parseCouncilAnalysis,
} from "@/lib/server/council/analysis";
import {
  anonymizeMembers,
  deanonymizeAnalysis,
} from "@/lib/server/council/anonymize";
import { estimateCouncilCost } from "@/lib/server/council/estimate";
import {
  pickSubstituteModel,
  resolveBalancedPreset,
  resolveBudgetPreset,
  validateCouncilMembers,
  type CatalogModel,
  strengthScore,
} from "@/lib/server/council/presets";
import { councilAnalysisSchema } from "@/lib/server/council/types";

const FIXTURE: CatalogModel[] = [
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    lab: "openai",
    contextLength: 128000,
    priceInPerMtok: 2.5,
    priceOutPerMtok: 10,
    supportsReasoning: false,
    modalities: ["text"],
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    lab: "anthropic",
    contextLength: 200000,
    priceInPerMtok: 3,
    priceOutPerMtok: 15,
    supportsReasoning: true,
    modalities: ["text"],
  },
  {
    id: "google/gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    lab: "google",
    contextLength: 1000000,
    priceInPerMtok: 0.1,
    priceOutPerMtok: 0.4,
    supportsReasoning: false,
    modalities: ["text"],
  },
  {
    id: "meta-llama/llama-3.3-70b",
    name: "Llama 3.3 70B",
    lab: "meta-llama",
    contextLength: 128000,
    priceInPerMtok: 0.35,
    priceOutPerMtok: 0.4,
    supportsReasoning: false,
    modalities: ["text"],
  },
  {
    id: "mistralai/mistral-small",
    name: "Mistral Small",
    lab: "mistralai",
    contextLength: 128000,
    priceInPerMtok: 0.1,
    priceOutPerMtok: 0.3,
    supportsReasoning: false,
    modalities: ["text"],
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    lab: "deepseek",
    contextLength: 64000,
    priceInPerMtok: 0.14,
    priceOutPerMtok: 0.28,
    supportsReasoning: false,
    modalities: ["text"],
  },
  {
    id: "openai/text-embedding-3-small",
    name: "Embeddings",
    lab: "openai",
    contextLength: 8000,
    priceInPerMtok: 0.02,
    priceOutPerMtok: 0,
    supportsReasoning: false,
    modalities: ["text"],
  },
];

describe("council estimate", () => {
  it("computes per-member and total cost range", () => {
    const estimate = estimateCouncilCost({
      contextChars: 4000,
      config: {
        members: [
          "openai/gpt-4o",
          "anthropic/claude-3.5-sonnet",
          "google/gemini-2.0-flash",
        ],
        synthesizer: "openai/gpt-4o",
        maxOutputTokensPerMember: 2000,
        budgetCapUsd: 0.5,
        memberTimeoutSec: 120,
        preset: "balanced",
      },
      catalog: FIXTURE,
    });
    expect(estimate.inputTokensEst).toBe(1000);
    expect(estimate.lines.length).toBe(4);
    expect(estimate.totalHighUsd).toBeGreaterThan(estimate.totalLowUsd);
    expect(estimate.totalHighUsd).toBeGreaterThan(0);
  });
});

describe("presets", () => {
  it("balanced picks 3 distinct major labs", () => {
    const { members } = resolveBalancedPreset(FIXTURE);
    expect(members.length).toBe(3);
    const labs = new Set(members.map((id) => id.split("/")[0]));
    expect(labs.size).toBe(3);
  });

  it("budget picks open-weight models with ≥64k context", () => {
    const { members } = resolveBudgetPreset(FIXTURE);
    expect(members.length).toBe(3);
    for (const id of members) {
      const m = FIXTURE.find((x) => x.id === id)!;
      expect((m.contextLength ?? 0) >= 64_000).toBe(true);
    }
    const labs = new Set(members.map((id) => id.split("/")[0]));
    expect(labs.size).toBe(3);
  });

  it("strengthScore prefers reasoning + context", () => {
    const a = FIXTURE.find((m) => m.id.includes("claude"))!;
    const b = FIXTURE.find((m) => m.id.includes("gemini"))!;
    expect(strengthScore(a)).toBeGreaterThan(strengthScore(b));
  });

  it("lab diversity warns under 3 labs", () => {
    const v = validateCouncilMembers(["openai/a", "openai/b", "openai/c"]);
    expect(v.ok).toBe(true);
    expect(v.labWarning).toMatch(/lab/);
  });

  it("substitution picks a lab not already present", () => {
    const sub = pickSubstituteModel(
      FIXTURE,
      [
        "openai/gpt-4o",
        "anthropic/claude-3.5-sonnet",
        "google/gemini-2.0-flash",
      ],
      "openai/gpt-4o",
    );
    expect(sub).toBeTruthy();
    expect(["openai", "anthropic", "google"]).not.toContain(sub!.lab);
  });
});

describe("anonymize", () => {
  it("shuffles and maps labels back", () => {
    const random = vi.fn().mockReturnValueOnce(0.9).mockReturnValue(0.1);
    const { anonymized, labelToModelId } = anonymizeMembers(
      [
        { modelId: "openai/a", content: "A says one" },
        { modelId: "anthropic/b", content: "B says two" },
        { modelId: "google/c", content: "C says three" },
      ],
      random,
    );
    expect(anonymized).toHaveLength(3);
    expect(anonymized.every((m) => m.label.startsWith("Member "))).toBe(true);
    const analysis = councilAnalysisSchema.parse({
      finalAnswer: "ok",
      consensus: [],
      contradictions: [
        {
          topic: "t",
          positions: anonymized.map((m) => ({
            member: m.label,
            stance: "x",
          })),
          needsEvidence: true,
        },
      ],
      uniqueInsights: [],
      blindSpots: [],
      confidence: "medium",
    });
    const mapped = deanonymizeAnalysis(analysis, labelToModelId);
    for (const p of mapped.contradictions[0]!.positions) {
      expect(p.member).toMatch(/\//);
    }
  });
});

describe("synthesizer JSON", () => {
  it("parses valid JSON and repairs from fenced malformed shell", () => {
    const good = parseCouncilAnalysis(
      JSON.stringify({
        finalAnswer: "Answer",
        consensus: ["c1"],
        contradictions: [
          {
            topic: "dose",
            positions: [{ member: "Member A", stance: "high" }],
            needsEvidence: true,
          },
        ],
        uniqueInsights: [],
        blindSpots: ["b1"],
        confidence: "high",
      }),
    );
    expect(good.ok).toBe(true);

    const extracted = extractJsonObject(
      'Here you go:\n```json\n{"finalAnswer":"x","consensus":[],"contradictions":[],"uniqueInsights":[],"blindSpots":[],"confidence":"low"}\n```',
    );
    expect(extracted).toContain("finalAnswer");
    const repaired = parseCouncilAnalysis(extracted!);
    expect(repaired.ok).toBe(true);
  });
});

describe("budget gate", () => {
  it("flags over-cap when high estimate exceeds cap", () => {
    const estimate = estimateCouncilCost({
      contextChars: 200_000,
      config: {
        members: [
          "openai/gpt-4o",
          "anthropic/claude-3.5-sonnet",
          "google/gemini-2.0-flash",
        ],
        synthesizer: "openai/gpt-4o",
        maxOutputTokensPerMember: 8000,
        budgetCapUsd: 0.01,
        memberTimeoutSec: 120,
        preset: "balanced",
      },
      catalog: FIXTURE,
    });
    expect(estimate.totalHighUsd).toBeGreaterThan(0.01);
  });
});

describe("resilience thresholds", () => {
  it("continues with 1-of-3 failure, fails with 2-of-3", async () => {
    const { councilHasEnoughMembers } =
      await import("@/lib/server/council/types");
    expect(councilHasEnoughMembers(2)).toBe(true); // 1 failed of 3
    expect(councilHasEnoughMembers(1)).toBe(false); // 2 failed of 3
  });
});

describe("council history for later turns", () => {
  it("keeps only the final answer from prior council replies", async () => {
    const { sanitizeCouncilHistoryForModel } =
      await import("@/lib/server/council/history");
    const messages = [
      {
        id: "u1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Q1" }],
      },
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          { type: "text" as const, text: "Final synthesizer answer" },
          {
            type: "data-member" as const,
            data: {
              modelId: "openai/gpt-4o",
              content: "SECRET_MEMBER_A_ONLY",
              status: "done",
            },
          },
          {
            type: "data-member" as const,
            data: {
              modelId: "anthropic/claude",
              content: "SECRET_MEMBER_B_ONLY",
              status: "done",
            },
          },
          {
            type: "data-analysis" as const,
            data: { finalAnswer: "Final synthesizer answer" },
          },
          {
            type: "data-council-summary" as const,
            data: { membersOk: 2, membersFailed: 0, totalCost: 0.01 },
          },
        ],
      },
      {
        id: "u2",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Follow up" }],
      },
    ];
    const cleaned = sanitizeCouncilHistoryForModel(messages);
    const blob = JSON.stringify(cleaned);
    expect(blob).toContain("Final synthesizer answer");
    expect(blob).not.toContain("SECRET_MEMBER_A_ONLY");
    expect(blob).not.toContain("SECRET_MEMBER_B_ONLY");
    expect(cleaned[1]?.parts).toEqual([
      { type: "text", text: "Final synthesizer answer" },
    ]);
  });
});
