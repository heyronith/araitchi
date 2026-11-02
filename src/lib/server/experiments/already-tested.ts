import "server-only";

import { listRecords } from "@/lib/server/project/records";

import { listExperiments } from "./store";
import { effectiveVerdict } from "./verdict";

/**
 * Compact "Already tested" lines for the context package.
 * Includes refuted + inconclusive (+ supported) so the team doesn't re-propose blindly.
 */
export function listAlreadyTested(projectPath: string): {
  hypothesisId: string;
  title: string;
  status: string;
  experimentId: string | null;
  verdict: string | null;
}[] {
  const hyps = listRecords(projectPath, { type: "hypothesis" }).filter((h) =>
    ["supported", "refuted", "inconclusive"].includes(h.status ?? ""),
  );
  const exps = listExperiments(projectPath);
  const out: {
    hypothesisId: string;
    title: string;
    status: string;
    experimentId: string | null;
    verdict: string | null;
  }[] = [];

  for (const h of hyps) {
    const linked = exps.find((e) => e.hypothesisIds.includes(h.id));
    out.push({
      hypothesisId: h.id,
      title: h.title,
      status: h.status ?? "unknown",
      experimentId: linked?.id ?? null,
      verdict: linked ? effectiveVerdict(linked) : h.status,
    });
  }
  return out;
}

export function formatAlreadyTestedSection(projectPath: string): string {
  const items = listAlreadyTested(projectPath);
  if (!items.length) return "";
  const lines = items.map((i) => {
    const exp = i.experimentId ? ` via ${i.experimentId}` : "";
    return `- [H-${i.hypothesisId.slice(0, 6)}] ${i.title} — **${i.status}**${exp}`;
  });
  return ["## Already tested", ...lines, ""].join("\n");
}
