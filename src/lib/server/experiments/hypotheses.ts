import "server-only";

import { getRecord, updateRecord } from "@/lib/server/project/records";
import type { HypothesisStatus } from "@/lib/server/project/types";

import type { Verdict } from "./types";

/** Map experiment verdict → hypothesis status (validation loop only). */
export function verdictToHypothesisStatus(
  verdict: Verdict,
): HypothesisStatus | null {
  if (verdict === "supported" || verdict === "replicated") return "supported";
  if (verdict === "refuted") return "refuted";
  if (verdict === "inconclusive") return "inconclusive";
  return null;
}

/**
 * Update linked hypotheses from a validation-loop verdict.
 * This (and explicit user edits) are the only ways to set supported/refuted/inconclusive.
 */
export function applyVerdictToHypotheses(
  projectPath: string,
  hypothesisIds: string[],
  verdict: Verdict,
): void {
  const status = verdictToHypothesisStatus(verdict);
  if (!status) return;
  for (const id of hypothesisIds) {
    const rec = getRecord(projectPath, id);
    if (!rec || rec.type !== "hypothesis") continue;
    updateRecord(projectPath, id, { status });
  }
}

/** User may set hypothesis status freely from the memory UI. */
export function userMaySetHypothesisStatus(status: string): boolean {
  return [
    "proposed",
    "testing",
    "supported",
    "refuted",
    "inconclusive",
  ].includes(status);
}
