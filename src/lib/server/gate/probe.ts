import "server-only";

import { generateText } from "ai";
import { z } from "zod";

import { extractJsonObject } from "@/lib/server/council/analysis";
import { createOpenRouterClient } from "@/lib/server/openrouter";
import { loadDefaults } from "@/lib/server/defaults";
import { labFromModelId } from "@/lib/server/models-utils";

import { getGateSettings } from "./settings";

export type ProbeAnswer = {
  modelId: string;
  lab: string;
  content: string;
  claims: string[];
  finalAnswer: string;
  selfConfidence: number;
  costUsd: number | null;
  latencyMs: number;
};

export type ProbeResult = {
  answers: ProbeAnswer[];
  /** 1 when final answers match (and claim overlap soft-score), else 0. */
  agreement: number;
  agreed: boolean;
  winner: ProbeAnswer | null;
  /** When disagreeing, escalate to council reusing these as pre-filled members. */
  escalate: boolean;
};

export type ProbeStructure = {
  finalAnswer: string;
  keyClaims: string[];
};

const structureSchema = z.object({
  finalAnswer: z.string().min(1).max(500),
  keyClaims: z.array(z.string().min(1).max(400)).max(8).default([]),
});

const EXTRACT_SYSTEM = `Extract the answer as JSON only:
{"finalAnswer":"short final answer (letter A-D if multiple choice, else concise value)","keyClaims":["up to 5 short supporting claims"]}
Rules: finalAnswer is the decisive answer only — no hedging. keyClaims are distinct factual claims.`;

/**
 * Extract rough "key claims" as sentence-like chunks (fallback when JSON extract fails).
 */
export function extractKeyClaims(text: string, max = 8): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 400);
  if (parts.length) return parts.slice(0, max);
  const trimmed = text.trim();
  return trimmed ? [trimmed.slice(0, 400)] : [];
}

/** Normalize final answers for exact compare (MC letters, whitespace, case). */
export function normalizeFinalAnswer(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  const letter = t.match(/^(?:answer\s*[:=]?\s*)?([A-D])(?:\b|[.)])/i);
  if (letter) return letter[1]!.toUpperCase();
  const lone = t.match(/^([A-D])$/i);
  if (lone) return lone[1]!.toUpperCase();
  return t.toLowerCase();
}

function claimTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

/** Jaccard overlap of claim token sets (0–1). */
export function keyClaimOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const ta = new Set<string>();
  const tb = new Set<string>();
  for (const c of a) for (const t of claimTokens(c)) ta.add(t);
  for (const c of b) for (const t of claimTokens(c)) tb.add(t);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Structured agreement: disagreement on normalized finalAnswer → 0 (escalate).
 * Matching finals → 0.7 + 0.3 * claim overlap (capped at 1).
 */
export function scoreStructuredAgreement(
  a: ProbeStructure,
  b: ProbeStructure,
): number {
  const fa = normalizeFinalAnswer(a.finalAnswer);
  const fb = normalizeFinalAnswer(b.finalAnswer);
  if (!fa || !fb || fa !== fb) return 0;
  const overlap = keyClaimOverlap(a.keyClaims, b.keyClaims);
  return Math.min(1, 0.7 + 0.3 * overlap);
}

/** @deprecated embedding path removed; kept as alias for tests/callers. */
export async function scoreProbeAgreement(
  a: { content: string; claims: string[]; finalAnswer?: string },
  b: { content: string; claims: string[]; finalAnswer?: string },
): Promise<number> {
  return scoreStructuredAgreement(
    {
      finalAnswer: a.finalAnswer ?? a.content.slice(0, 200),
      keyClaims: a.claims,
    },
    {
      finalAnswer: b.finalAnswer ?? b.content.slice(0, 200),
      keyClaims: b.claims,
    },
  );
}

function heuristicStructure(text: string): ProbeStructure {
  const letter = text.match(/\b([A-D])\b/);
  const finalAnswer = letter?.[1]?.toUpperCase() ?? text.trim().slice(0, 200);
  return { finalAnswer, keyClaims: extractKeyClaims(text, 5) };
}

export function parseProbeStructure(text: string): ProbeStructure | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  try {
    const parsed = structureSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    return {
      finalAnswer: parsed.data.finalAnswer,
      keyClaims: parsed.data.keyClaims,
    };
  } catch {
    return null;
  }
}

export async function extractProbeStructure(input: {
  apiKey: string;
  modelId: string;
  answerText: string;
  signal?: AbortSignal;
}): Promise<{ structure: ProbeStructure; costUsd: number | null }> {
  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });
  try {
    const result = await generateText({
      model,
      system: EXTRACT_SYSTEM,
      prompt: input.answerText.slice(0, 4000),
      maxOutputTokens: 256,
      abortSignal: input.signal,
    });
    const cost =
      (
        (await result.providerMetadata)?.openrouter as
          { usage?: { cost?: number } } | undefined
      )?.usage?.cost ?? null;
    const parsed = parseProbeStructure(result.text);
    return {
      structure: parsed ?? heuristicStructure(input.answerText),
      costUsd: cost,
    };
  } catch {
    return {
      structure: heuristicStructure(input.answerText),
      costUsd: null,
    };
  }
}

function parseSelfConfidence(text: string): number {
  const m = text.match(/confidence\s*[:=]\s*([01](?:\.\d+)?)/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  }
  return 0.5;
}

async function runProbeMember(input: {
  apiKey: string;
  modelId: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<ProbeAnswer> {
  const t0 = Date.now();
  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });
  const result = await generateText({
    model,
    system: input.system,
    prompt: input.user,
    maxOutputTokens: 1024,
    abortSignal: input.signal,
  });
  const cost =
    (
      (await result.providerMetadata)?.openrouter as
        { usage?: { cost?: number } } | undefined
    )?.usage?.cost ?? null;
  const content = result.text;
  return {
    modelId: input.modelId,
    lab: labFromModelId(input.modelId),
    content,
    claims: extractKeyClaims(content),
    finalAnswer: heuristicStructure(content).finalAnswer,
    selfConfidence: parseSelfConfidence(content),
    costUsd: cost,
    latencyMs: Date.now() - t0,
  };
}

/**
 * Run two probe models in parallel and decide agree vs escalate via structured
 * finalAnswer comparison (not embedding similarity).
 */
export async function runProbe(input: {
  projectPath: string;
  apiKey: string;
  userText: string;
  projectSystem: string;
  signal?: AbortSignal;
  /** Test injection */
  mockAnswers?: [ProbeAnswer, ProbeAnswer];
}): Promise<ProbeResult> {
  const settings = getGateSettings(input.projectPath);

  let answers: ProbeAnswer[];

  if (input.mockAnswers) {
    answers = [...input.mockAnswers];
  } else if (!settings.probeEnabled) {
    return {
      answers: [],
      agreement: 0,
      agreed: false,
      winner: null,
      escalate: true,
    };
  } else {
    const system = `${input.projectSystem}\n\nYou are one of two independent probes. End with a line "confidence: 0.0-1.0" for your own certainty. For multiple choice, state the letter clearly.`;
    const [a, b] = await Promise.all([
      runProbeMember({
        apiKey: input.apiKey,
        modelId: settings.probeModels[0],
        system,
        user: input.userText,
        signal: input.signal,
      }),
      runProbeMember({
        apiKey: input.apiKey,
        modelId: settings.probeModels[1],
        system,
        user: input.userText,
        signal: input.signal,
      }),
    ]);
    answers = [a, b];
  }

  const extractModel =
    loadDefaults().paperEnhanceModel || "~google/gemini-flash-latest";

  const structures: ProbeStructure[] = [];
  if (input.mockAnswers) {
    for (const ans of answers) {
      structures.push({
        finalAnswer: ans.finalAnswer || ans.content.slice(0, 200),
        keyClaims: ans.claims,
      });
    }
  } else {
    const extracted = await Promise.all(
      answers.map((ans) =>
        extractProbeStructure({
          apiKey: input.apiKey,
          modelId: extractModel,
          answerText: ans.content,
          signal: input.signal,
        }),
      ),
    );
    for (let i = 0; i < answers.length; i++) {
      const ex = extracted[i]!;
      structures.push(ex.structure);
      const costSum = (answers[i]!.costUsd ?? 0) + (ex.costUsd ?? 0);
      answers[i] = {
        ...answers[i]!,
        finalAnswer: ex.structure.finalAnswer,
        claims: ex.structure.keyClaims.length
          ? ex.structure.keyClaims
          : answers[i]!.claims,
        costUsd: costSum > 0 ? costSum : answers[i]!.costUsd,
      };
    }
  }

  const agreement = scoreStructuredAgreement(structures[0]!, structures[1]!);
  const agreed = agreement >= settings.probeAgreementThreshold;

  let winner: ProbeAnswer | null = null;
  if (agreed) {
    const [x, y] = answers;
    winner =
      x!.selfConfidence > y!.selfConfidence
        ? x!
        : x!.selfConfidence < y!.selfConfidence
          ? y!
          : x!;
  }

  return {
    answers,
    agreement,
    agreed,
    winner,
    escalate: !agreed,
  };
}
