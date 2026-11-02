import { councilAnalysisSchema, type CouncilAnalysis } from "./types";

/** Extract first JSON object from a model reply (handles fences / prose). */
export function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function parseCouncilAnalysis(
  text: string,
):
  | { ok: true; analysis: CouncilAnalysis }
  | { ok: false; error: string; raw: string } {
  const json = extractJsonObject(text);
  if (!json) {
    return { ok: false, error: "No JSON object found", raw: text };
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    const result = councilAnalysisSchema.safeParse(parsed);
    if (!result.success) {
      return {
        ok: false,
        error: result.error.message,
        raw: text,
      };
    }
    return { ok: true, analysis: result.data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "JSON parse failed",
      raw: text,
    };
  }
}

export const ANALYSIS_REPAIR_PROMPT = `Your previous reply was not valid JSON for the required schema. Reply again with ONLY a valid JSON object (no markdown fences, no commentary) matching the synthesizer schema.`;
