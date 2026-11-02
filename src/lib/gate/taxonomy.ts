/** Shared task taxonomy for classifier, merge modes, and UI. */

export const TASK_TYPES = [
  "hypothesis_generation",
  "experiment_design",
  "literature_review",
  "critique",
  "results_interpretation",
  "factual_lookup",
  "chat",
  "formatting",
  "summarize_single",
  "repo_status",
  "code_help",
  "planning_admin",
  "other",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export type Stakes = "low" | "medium" | "high";

export type GateAction = "retrieve_evidence" | "solo" | "probe" | "council";

export type GateLayer = "rule" | "knn" | "llm" | "forced";

/** Task types that always convene a council (research-critical). */
export const ALWAYS_COUNCIL: ReadonlySet<TaskType> = new Set([
  "hypothesis_generation",
  "experiment_design",
  "literature_review",
  "critique",
  "results_interpretation",
]);

export const EVIDENCE_TASKS: ReadonlySet<TaskType> = new Set([
  "factual_lookup",
]);

export const SOLO_TASKS: ReadonlySet<TaskType> = new Set([
  "chat",
  "formatting",
  "summarize_single",
  "repo_status",
  "code_help",
  "planning_admin",
]);

export function actionForTaskType(taskType: TaskType): GateAction {
  if (ALWAYS_COUNCIL.has(taskType)) return "council";
  if (EVIDENCE_TASKS.has(taskType)) return "retrieve_evidence";
  if (SOLO_TASKS.has(taskType)) return "solo";
  return "probe";
}

export function isTaskType(v: string): v is TaskType {
  return (TASK_TYPES as readonly string[]).includes(v);
}

export function mergeModeForTask(
  taskType: TaskType,
):
  | "literature_review"
  | "hypothesis_generation"
  | "experiment_design"
  | "critique"
  | "results_interpretation"
  | "generic" {
  if (
    taskType === "literature_review" ||
    taskType === "hypothesis_generation" ||
    taskType === "experiment_design" ||
    taskType === "critique" ||
    taskType === "results_interpretation"
  ) {
    return taskType;
  }
  return "generic";
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  hypothesis_generation: "hypothesis generation",
  experiment_design: "experiment design",
  literature_review: "literature review",
  critique: "critique",
  results_interpretation: "results interpretation",
  factual_lookup: "factual lookup",
  chat: "chat",
  formatting: "formatting",
  summarize_single: "summarize",
  repo_status: "repo status",
  code_help: "code help",
  planning_admin: "planning",
  other: "other",
};

export const ACTION_LABELS: Record<GateAction, string> = {
  retrieve_evidence: "Evidence",
  solo: "Solo",
  probe: "Probe",
  council: "Council",
};
