import "server-only";

import { loadPrompt } from "@/lib/server/prompts/load";

import { mergeModeForTask, type TaskType } from "./taxonomy";

const MERGE_FILES: Record<string, string> = {
  literature_review: "merge/literature_review.md",
  hypothesis_generation: "merge/hypothesis_generation.md",
  experiment_design: "merge/experiment_design.md",
  critique: "merge/critique.md",
  results_interpretation: "merge/results_interpretation.md",
  generic: "merge/generic.md",
};

/** Resolve synthesizer system prompt for a task type (base + merge variant). */
export function synthesizerPromptForTask(taskType: TaskType): string {
  const mode = mergeModeForTask(taskType);
  const base = loadPrompt("council-synthesizer.md");
  const variant = loadPrompt(MERGE_FILES[mode] ?? MERGE_FILES.generic!);
  return `${base}\n\n---\n## Task-specific merge mode: ${mode}\n\n${variant}`;
}

export function mergePromptPath(taskType: TaskType): string {
  const mode = mergeModeForTask(taskType);
  return MERGE_FILES[mode] ?? MERGE_FILES.generic!;
}
