import "server-only";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { researchDir } from "@/lib/server/project/init";
import { exportMemoryMd } from "@/lib/server/project/exporters";

import { generateCursorInstructions } from "./instructions";
import type { ExperimentRow, Verdict } from "./types";
import { effectiveVerdict } from "./verdict";

export function experimentResearchDir(
  projectPath: string,
  experimentId: string,
): string {
  return path.join(researchDir(projectPath), "experiments", experimentId);
}

export function writeExperimentArtifacts(
  projectPath: string,
  exp: ExperimentRow,
): { instructionsPath: string; schemaPath: string } {
  const dir = experimentResearchDir(projectPath, exp.id);
  mkdirSync(dir, { recursive: true });
  const instructionsPath = path.join(dir, "instructions.md");
  const schemaPath = path.join(dir, "results.schema.json");
  writeFileSync(instructionsPath, generateCursorInstructions(exp), "utf8");
  writeFileSync(
    schemaPath,
    JSON.stringify(exp.resultsSchema, null, 2) + "\n",
    "utf8",
  );
  return { instructionsPath, schemaPath };
}

export function writeExperimentReport(
  projectPath: string,
  exp: ExperimentRow,
): string {
  const dir = experimentResearchDir(projectPath, exp.id);
  mkdirSync(dir, { recursive: true });
  const verdict = effectiveVerdict(exp);
  const lines = [
    `# Experiment report — ${exp.id}`,
    "",
    `- Title: ${exp.title}`,
    `- Version: ${exp.version}`,
    `- Status: ${exp.status}`,
    `- Verdict: ${verdict ?? "—"}`,
    `- Lock hash: \`${exp.lockHash ?? "—"}\``,
    "",
    "## Objective",
    "",
    exp.objective,
    "",
    "## Predictions",
    "",
    ...exp.predictions.map(
      (p) =>
        `- ${p.id}: ${p.aggregate}(${p.metric}) ${p.comparator} ${
          p.comparator === "between"
            ? `[${p.low}, ${p.high}]`
            : p.comparator === "improves_over"
              ? `baseline ${p.baseline?.metric} ≥${p.minImprovementPct ?? 0}%`
              : String(p.value)
        }`,
    ),
    "",
  ];
  if (exp.verdictEvidence) {
    lines.push(
      "## Verdict evidence",
      "",
      `- Commit: \`${exp.verdictEvidence.commitSha ?? "—"}\``,
      `- File: \`${exp.verdictEvidence.filePath}\``,
      `- Runs: ${exp.verdictEvidence.runCount}/${exp.verdictEvidence.requiredRuns}`,
      "",
      ...exp.verdictEvidence.reasons.map((r) => `- ${r}`),
      "",
      "### Per prediction",
      "",
      ...exp.verdictEvidence.predictions.map(
        (p) =>
          `- ${p.predictionId}: ${p.pass === true ? "PASS" : p.pass === false ? "FAIL" : "?"} — observed ${JSON.stringify(p.observed)} — ${p.expected}`,
      ),
      "",
    );
  }
  if (exp.interpretation) {
    lines.push(
      "## Interpretation",
      "",
      exp.interpretationConcern ? "_Concern flag raised._" : "",
      "",
      exp.interpretation,
      "",
    );
  }
  if (exp.overrideReason) {
    lines.push(
      "## User override",
      "",
      `- To: ${exp.overrideVerdict}`,
      `- Reason: ${exp.overrideReason}`,
      `- At: ${exp.overrideAt ? new Date(exp.overrideAt).toISOString() : "—"}`,
      "",
    );
  }
  const out = lines.filter((l) => l !== undefined).join("\n");
  const reportPath = path.join(dir, "report.md");
  writeFileSync(reportPath, out, "utf8");
  return reportPath;
}

/** Append compact verdict lines into memory.md via record export + note. */
export function syncVerdictIntoMemory(
  projectPath: string,
  exp: ExperimentRow,
  verdict: Verdict,
): void {
  writeExperimentReport(projectPath, exp);
  // Re-export memory.md so exporters stay current; verdict details live in report.md
  exportMemoryMd(projectPath);
  const dir = experimentResearchDir(projectPath, exp.id);
  const memoryNote = path.join(dir, "verdict.md");
  writeFileSync(
    memoryNote,
    `# Verdict ${exp.id}\n\n**${verdict}** — ${exp.title}\n\nSee report.md for evidence.\n`,
    "utf8",
  );
}
