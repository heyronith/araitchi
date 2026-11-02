import "server-only";

import { generateText } from "ai";
import { z } from "zod";

import { extractJsonObject } from "@/lib/server/council/analysis";
import { createOpenRouterClient } from "@/lib/server/openrouter";

import { TASK_TYPES, type Stakes, type TaskType } from "./taxonomy";

export const classifierOutputSchema = z.object({
  taskType: z.enum(TASK_TYPES),
  stakes: z.enum(["low", "medium", "high"]),
  needsEvidence: z.boolean(),
  reason: z.string().min(1).max(500),
});

export type ClassifierLlmOutput = z.infer<typeof classifierOutputSchema>;

const SYSTEM = `You classify research-assistant user messages.
Reply with ONLY JSON:
{"taskType": one of ${JSON.stringify(TASK_TYPES)}, "stakes":"low|medium|high", "needsEvidence": boolean, "reason":"short"}
Rules:
- hypothesis_generation / experiment_design / literature_review / critique / results_interpretation are research-critical.
- factual_lookup needsEvidence=true.
- chat/formatting/summarize_single/repo_status/code_help/planning_admin are routine.
- other = ambiguous.`;

export function parseClassifierOutput(
  text: string,
): { ok: true; value: ClassifierLlmOutput } | { ok: false; error: string } {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, error: "No JSON" };
  try {
    const parsed = classifierOutputSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    return { ok: true, value: parsed.data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "parse failed",
    };
  }
}

export async function classifyWithLlm(input: {
  apiKey: string;
  modelId: string;
  text: string;
  signal?: AbortSignal;
}): Promise<ClassifierLlmOutput & { costUsd: number | null }> {
  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });
  const result = await generateText({
    model,
    system: SYSTEM,
    prompt: input.text.slice(0, 4000),
    abortSignal: input.signal,
  });
  const cost =
    (
      (await result.providerMetadata)?.openrouter as
        { usage?: { cost?: number } } | undefined
    )?.usage?.cost ?? null;
  let parsed = parseClassifierOutput(result.text);
  if (!parsed.ok) {
    const repair = await generateText({
      model,
      system: SYSTEM,
      prompt: `Previous invalid reply. Emit ONLY valid JSON.\nUser message:\n${input.text.slice(0, 2000)}\n\nBad reply:\n${result.text.slice(0, 500)}`,
      abortSignal: input.signal,
    });
    parsed = parseClassifierOutput(repair.text);
    if (!parsed.ok) {
      return {
        taskType: "other" as TaskType,
        stakes: "medium" as Stakes,
        needsEvidence: false,
        reason: `LLM classify failed: ${parsed.error}`,
        costUsd: cost,
      };
    }
  }
  return { ...parsed.value, costUsd: cost };
}
