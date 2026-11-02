import "server-only";

import { generateText } from "ai";

import { extractJsonObject } from "@/lib/server/council/analysis";
import { createOpenRouterClient } from "@/lib/server/openrouter";
import { getRecord } from "@/lib/server/project/records";

import { experimentDraftSchema, type ExperimentDraft } from "./types";

const SYSTEM = `You design a preregistered software/research experiment for Araitchi.
Reply with ONLY JSON matching:
{
  "title": string,
  "objective": string,
  "protocol": string (markdown steps),
  "baselines": string,
  "dataset": string,
  "requiredRuns": number (e.g. 3),
  "seeds": number[] (same length as requiredRuns or more),
  "environmentNotes": string,
  "predictions": [
    {
      "id": "p1",
      "metric": "string",
      "comparator": ">"|">="|"<"|"<="|"=="|"between"|"improves_over",
      "value"?: number,
      "tolerance"?: number,
      "low"?: number,
      "high"?: number,
      "baseline"?: { "metric": string },
      "minImprovementPct"?: number,
      "aggregate": "mean"|"median"|"all_runs"|"any_run"
    }
  ]
}
Predictions must be machine-checkable. Prefer mean/median aggregates. Include at least one prediction.`;

export function parseExperimentDraft(
  text: string,
): { ok: true; value: ExperimentDraft } | { ok: false; error: string } {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, error: "No JSON object in model reply" };
  try {
    const parsed = experimentDraftSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    return { ok: true, value: parsed.data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "JSON parse failed",
    };
  }
}

export async function designExperimentDraft(input: {
  apiKey: string;
  modelId: string;
  projectPath: string;
  hypothesisId?: string;
  prompt?: string;
  signal?: AbortSignal;
}): Promise<ExperimentDraft> {
  let userPrompt = input.prompt?.trim() || "";
  if (input.hypothesisId) {
    const hyp = getRecord(input.projectPath, input.hypothesisId);
    if (hyp) {
      userPrompt =
        `Hypothesis [${hyp.id}] ${hyp.title}\n\n${hyp.body}\n\n${userPrompt}`.trim();
    }
  }
  if (!userPrompt) {
    throw new Error("Provide a hypothesisId or design prompt");
  }

  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });

  const run = async (extra?: string) => {
    const result = await generateText({
      model,
      system: SYSTEM,
      prompt: extra ? `${userPrompt}\n\n${extra}` : userPrompt,
      maxOutputTokens: 2048,
      abortSignal: input.signal,
    });
    return parseExperimentDraft(result.text);
  };

  let parsed = await run();
  if (!parsed.ok) {
    parsed = await run(
      `Repair: previous output invalid (${parsed.error}). Return ONLY valid JSON.`,
    );
  }
  if (!parsed.ok) throw new Error(`Experiment draft invalid: ${parsed.error}`);
  return parsed.value;
}
