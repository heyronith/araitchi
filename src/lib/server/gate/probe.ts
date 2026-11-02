import "server-only";

import { generateText } from "ai";

import { createOpenRouterClient } from "@/lib/server/openrouter";
import { getEmbedder } from "@/lib/server/memory/embedder";
import { cosine } from "@/lib/server/memory/vector";
import { labFromModelId } from "@/lib/server/models-utils";

import { getGateSettings } from "./settings";

export type ProbeAnswer = {
  modelId: string;
  lab: string;
  content: string;
  claims: string[];
  selfConfidence: number;
  costUsd: number | null;
  latencyMs: number;
};

export type ProbeResult = {
  answers: ProbeAnswer[];
  agreement: number;
  agreed: boolean;
  winner: ProbeAnswer | null;
  /** When disagreeing, escalate to council reusing these as pre-filled members. */
  escalate: boolean;
};

/**
 * Extract rough "key claims" as sentence-like chunks (1–2 lines).
 * Used for claim-set embedding agreement.
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

/**
 * Agreement score = mean pairwise cosine of (answer embedding, mean claim embedding).
 * Documented method: embed full answers + each claim; average claim vectors per side;
 * agreement = 0.5 * cos(answers) + 0.5 * cos(claimMeans). Missing claims → answer-only.
 */
export async function scoreProbeAgreement(
  a: { content: string; claims: string[] },
  b: { content: string; claims: string[] },
): Promise<number> {
  const embedder = await getEmbedder();
  const texts = [
    a.content.slice(0, 4000),
    b.content.slice(0, 4000),
    ...a.claims.slice(0, 8),
    ...b.claims.slice(0, 8),
  ];
  const vectors = await embedder.embed(texts, { isQuery: false });
  const va = vectors[0]!;
  const vb = vectors[1]!;
  const answerCos = cosine(va, vb);

  const aClaims = a.claims.slice(0, 8);
  const bClaims = b.claims.slice(0, 8);
  if (!aClaims.length || !bClaims.length) return answerCos;

  const aStart = 2;
  const bStart = 2 + aClaims.length;
  const mean = (offs: number, n: number) => {
    const dims = vectors[offs]!.length;
    const out = new Float32Array(dims);
    for (let i = 0; i < n; i++) {
      const v = vectors[offs + i]!;
      for (let d = 0; d < dims; d++) out[d]! += v[d]!;
    }
    for (let d = 0; d < dims; d++) out[d]! /= n;
    return out;
  };
  const claimCos = cosine(
    mean(aStart, aClaims.length),
    mean(bStart, bClaims.length),
  );
  return 0.5 * answerCos + 0.5 * claimCos;
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
    selfConfidence: parseSelfConfidence(content),
    costUsd: cost,
    latencyMs: Date.now() - t0,
  };
}

/**
 * Run two probe models in parallel and decide agree vs escalate.
 * If needsEvidence and they agree, caller should still run retrieve_evidence.
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
  } else {
    const system = `${input.projectSystem}\n\nYou are one of two independent probes. End with a line "confidence: 0.0-1.0" for your own certainty.`;
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

  // Different labs preferred; still proceed if same lab configured.
  const agreement = await scoreProbeAgreement(answers[0]!, answers[1]!);
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
