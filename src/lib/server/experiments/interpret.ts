import "server-only";

import { generateText } from "ai";
import { z } from "zod";

import { extractJsonObject } from "@/lib/server/council/analysis";
import { createOpenRouterClient } from "@/lib/server/openrouter";

import type { ExperimentRow, Verdict, VerdictEvidence } from "./types";

export const interpretationSchema = z.object({
  note: z.string().min(1).max(8000),
  concern: z.boolean().default(false),
});

export type InterpretationOut = z.infer<typeof interpretationSchema>;

/**
 * LLM interpretation note. Must not alter the verdict — returns note + optional concern flag only.
 */
export async function interpretResults(input: {
  apiKey: string;
  modelId: string;
  experiment: ExperimentRow;
  verdict: Verdict;
  evidence: VerdictEvidence;
  signal?: AbortSignal;
}): Promise<InterpretationOut> {
  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });
  const system = `You write a short interpretation note for a preregistered experiment.
The deterministic verdict is FIXED and you MUST NOT suggest changing it.
Reply with ONLY JSON: {"note":"markdown…","concern":boolean}
Focus on confounds, threats to validity, and next steps. Set concern=true only for serious validity worries.`;

  const prompt = JSON.stringify(
    {
      title: input.experiment.title,
      objective: input.experiment.objective,
      verdict: input.verdict,
      evidence: input.evidence,
      predictions: input.experiment.predictions,
    },
    null,
    2,
  ).slice(0, 12_000);

  const result = await generateText({
    model,
    system,
    prompt,
    maxOutputTokens: 1024,
    abortSignal: input.signal,
  });

  const json = extractJsonObject(result.text);
  if (!json) {
    return {
      note: result.text.slice(0, 4000) || "No interpretation available.",
      concern: false,
    };
  }
  try {
    const parsed = interpretationSchema.safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  return {
    note: result.text.slice(0, 4000) || "No interpretation available.",
    concern: false,
  };
}

/** Test helper: ensure interpretation cannot smuggle a verdict change. */
export function mergeInterpretation(
  verdict: Verdict,
  interpretation: InterpretationOut,
): { verdict: Verdict; note: string; concern: boolean } {
  return {
    verdict,
    note: interpretation.note,
    concern: interpretation.concern,
  };
}
