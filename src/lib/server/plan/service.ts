import "server-only";

import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getNotebookDb } from "@/lib/server/project/db";
import {
  milestones,
  planSuggestions,
  planTasks,
} from "@/lib/server/project/schema";

export type TaskOwner = "me" | "team";
export type TaskStatus = "todo" | "doing" | "blocked" | "done";

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function listMilestones(projectPath: string) {
  return getNotebookDb(projectPath)
    .select()
    .from(milestones)
    .orderBy(asc(milestones.sortOrder), asc(milestones.createdAt))
    .all();
}

export function createMilestone(
  projectPath: string,
  input: {
    title: string;
    goal?: string;
    targetDate?: number | null;
    status?: string;
  },
) {
  const id = nanoid();
  const now = Date.now();
  const maxOrder =
    listMilestones(projectPath).reduce((m, x) => Math.max(m, x.sortOrder), -1) +
    1;
  getNotebookDb(projectPath)
    .insert(milestones)
    .values({
      id,
      title: input.title.trim(),
      goal: (input.goal ?? "").trim(),
      targetDate: input.targetDate ?? null,
      status: input.status ?? "open",
      sortOrder: maxOrder,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export function updateMilestone(
  projectPath: string,
  id: string,
  patch: Partial<{
    title: string;
    goal: string;
    targetDate: number | null;
    status: string;
    sortOrder: number;
  }>,
) {
  const row = getNotebookDb(projectPath)
    .select()
    .from(milestones)
    .where(eq(milestones.id, id))
    .get();
  if (!row) return false;
  getNotebookDb(projectPath)
    .update(milestones)
    .set({
      title: patch.title ?? row.title,
      goal: patch.goal ?? row.goal,
      targetDate:
        patch.targetDate !== undefined ? patch.targetDate : row.targetDate,
      status: patch.status ?? row.status,
      sortOrder: patch.sortOrder ?? row.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(milestones.id, id))
    .run();
  return true;
}

export type PlanTaskRow = typeof planTasks.$inferSelect & {
  hypothesisIdsParsed: string[];
  experimentIdsParsed: string[];
  paperIdsParsed: string[];
  filePathsParsed: string[];
};

function enrichTask(row: typeof planTasks.$inferSelect): PlanTaskRow {
  return {
    ...row,
    hypothesisIdsParsed: parseJsonArray(row.hypothesisIds),
    experimentIdsParsed: parseJsonArray(row.experimentIds),
    paperIdsParsed: parseJsonArray(row.paperIds),
    filePathsParsed: parseJsonArray(row.filePaths),
  };
}

export function listTasks(
  projectPath: string,
  filter?: { status?: TaskStatus; owner?: TaskOwner },
): PlanTaskRow[] {
  let rows = getNotebookDb(projectPath)
    .select()
    .from(planTasks)
    .orderBy(asc(planTasks.sortOrder), asc(planTasks.createdAt))
    .all();
  if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
  if (filter?.owner) rows = rows.filter((r) => r.owner === filter.owner);
  return rows.map(enrichTask);
}

export function getPlan(projectPath: string) {
  return {
    milestones: listMilestones(projectPath),
    tasks: listTasks(projectPath),
  };
}

export function createTask(
  projectPath: string,
  input: {
    title: string;
    description?: string;
    owner?: TaskOwner;
    status?: TaskStatus;
    dueDate?: number | null;
    milestoneId?: string | null;
    hypothesisIds?: string[];
    experimentIds?: string[];
    paperIds?: string[];
    filePaths?: string[];
  },
) {
  const id = nanoid();
  const now = Date.now();
  const maxOrder =
    listTasks(projectPath).reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1;
  getNotebookDb(projectPath)
    .insert(planTasks)
    .values({
      id,
      title: input.title.trim(),
      description: (input.description ?? "").trim(),
      owner: input.owner ?? "me",
      status: input.status ?? "todo",
      dueDate: input.dueDate ?? null,
      milestoneId: input.milestoneId ?? null,
      hypothesisIds: JSON.stringify(input.hypothesisIds ?? []),
      experimentIds: JSON.stringify(input.experimentIds ?? []),
      paperIds: JSON.stringify(input.paperIds ?? []),
      filePaths: JSON.stringify(input.filePaths ?? []),
      sortOrder: maxOrder,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export function updateTask(
  projectPath: string,
  id: string,
  patch: Partial<{
    title: string;
    description: string;
    owner: TaskOwner;
    status: TaskStatus;
    dueDate: number | null;
    milestoneId: string | null;
    hypothesisIds: string[];
    experimentIds: string[];
    paperIds: string[];
    filePaths: string[];
    sortOrder: number;
  }>,
) {
  const row = getNotebookDb(projectPath)
    .select()
    .from(planTasks)
    .where(eq(planTasks.id, id))
    .get();
  if (!row) return false;
  getNotebookDb(projectPath)
    .update(planTasks)
    .set({
      title: patch.title ?? row.title,
      description: patch.description ?? row.description,
      owner: patch.owner ?? row.owner,
      status: patch.status ?? row.status,
      dueDate: patch.dueDate !== undefined ? patch.dueDate : row.dueDate,
      milestoneId:
        patch.milestoneId !== undefined ? patch.milestoneId : row.milestoneId,
      hypothesisIds:
        patch.hypothesisIds !== undefined
          ? JSON.stringify(patch.hypothesisIds)
          : row.hypothesisIds,
      experimentIds:
        patch.experimentIds !== undefined
          ? JSON.stringify(patch.experimentIds)
          : row.experimentIds,
      paperIds:
        patch.paperIds !== undefined
          ? JSON.stringify(patch.paperIds)
          : row.paperIds,
      filePaths:
        patch.filePaths !== undefined
          ? JSON.stringify(patch.filePaths)
          : row.filePaths,
      sortOrder: patch.sortOrder ?? row.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(planTasks.id, id))
    .run();
  return true;
}

export function suggestPlanItem(
  projectPath: string,
  kind: "task" | "milestone",
  payload: Record<string, unknown>,
  reason = "",
) {
  const id = nanoid();
  getNotebookDb(projectPath)
    .insert(planSuggestions)
    .values({
      id,
      kind,
      payload: JSON.stringify(payload),
      reason,
      status: "pending",
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export function listPlanSuggestions(projectPath: string) {
  return getNotebookDb(projectPath)
    .select()
    .from(planSuggestions)
    .where(eq(planSuggestions.status, "pending"))
    .all();
}

export function acceptPlanSuggestion(projectPath: string, id: string): boolean {
  const row = getNotebookDb(projectPath)
    .select()
    .from(planSuggestions)
    .where(eq(planSuggestions.id, id))
    .get();
  if (!row || row.status !== "pending") return false;
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  if (row.kind === "milestone") {
    createMilestone(projectPath, {
      title: String(payload.title ?? "Untitled milestone"),
      goal: String(payload.goal ?? ""),
      targetDate:
        typeof payload.targetDate === "number" ? payload.targetDate : null,
    });
  } else {
    createTask(projectPath, {
      title: String(payload.title ?? "Untitled task"),
      description: String(payload.description ?? ""),
      owner: payload.owner === "team" ? "team" : "me",
      milestoneId:
        typeof payload.milestoneId === "string" ? payload.milestoneId : null,
    });
  }
  getNotebookDb(projectPath)
    .update(planSuggestions)
    .set({ status: "accepted" })
    .where(eq(planSuggestions.id, id))
    .run();
  return true;
}

export function dismissPlanSuggestion(
  projectPath: string,
  id: string,
): boolean {
  const row = getNotebookDb(projectPath)
    .select()
    .from(planSuggestions)
    .where(eq(planSuggestions.id, id))
    .get();
  if (!row) return false;
  getNotebookDb(projectPath)
    .update(planSuggestions)
    .set({ status: "dismissed" })
    .where(eq(planSuggestions.id, id))
    .run();
  return true;
}

/** Open tasks ordered by milestone then due date — for STATE.md Next steps. */
export function nextStepsFromTasks(projectPath: string): string {
  const plan = getPlan(projectPath);
  const open = plan.tasks.filter((t) => t.status !== "done");
  if (!open.length) return "_No open tasks._";
  const milestoneTitle = new Map(
    plan.milestones.map((m) => [m.id, m.title] as const),
  );
  const sorted = [...open].sort((a, b) => {
    const ma = a.milestoneId ?? "";
    const mb = b.milestoneId ?? "";
    if (ma !== mb) return ma.localeCompare(mb);
    const da = a.dueDate ?? Number.MAX_SAFE_INTEGER;
    const db = b.dueDate ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.sortOrder - b.sortOrder;
  });
  return sorted
    .map((t) => {
      const ms = t.milestoneId
        ? (milestoneTitle.get(t.milestoneId) ?? "Milestone")
        : null;
      const due = t.dueDate
        ? ` (due ${new Date(t.dueDate).toISOString().slice(0, 10)})`
        : "";
      const owner = t.owner === "team" ? " · team" : "";
      const prefix = ms ? `**${ms}:** ` : "";
      return `- [${t.status}] ${prefix}${t.title}${owner}${due}`;
    })
    .join("\n");
}

/** Prefill text when running a team task. */
export function runTaskPrefill(task: PlanTaskRow): {
  message: string;
  preferCouncil: boolean;
} {
  const lit = /literature|review|survey|novelty/i.test(
    `${task.title} ${task.description}`,
  );
  return {
    preferCouncil: lit || task.owner === "team",
    message: [
      `Task: ${task.title}`,
      task.description ? `\n${task.description}` : "",
      "\nPlease work this task. When finished, I'll mark it done.",
    ].join(""),
  };
}

/** After an experiment verdict, suggest an analyse-results task if linked. */
export function suggestAnalyseAfterVerdict(
  projectPath: string,
  experimentId: string,
  verdict: string,
) {
  const linked = listTasks(projectPath).filter((t) =>
    t.experimentIdsParsed.includes(experimentId),
  );
  for (const t of linked) {
    if (t.status === "done") continue;
    updateTask(projectPath, t.id, { status: "doing" });
  }
  return suggestPlanItem(
    projectPath,
    "task",
    {
      title: `Analyse results (${verdict})`,
      description: `Follow up on experiment ${experimentId} after verdict: ${verdict}`,
      owner: "me",
      experimentIds: [experimentId],
    },
    "Suggested after experiment verdict",
  );
}
