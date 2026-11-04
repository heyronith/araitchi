import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { rebuildStateMd, readStateMd } from "@/lib/server/continuity/state";
import {
  acceptPlanSuggestion,
  createMilestone,
  createTask,
  getPlan,
  listTasks,
  nextStepsFromTasks,
  runTaskPrefill,
  suggestAnalyseAfterVerdict,
  suggestPlanItem,
  updateTask,
} from "@/lib/server/plan/service";
import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";

afterEach(() => {
  closeAllNotebookDbs();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-plan-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "plan" });
  return dir;
}

describe("research plan", () => {
  it("CRUD milestones/tasks and suggestion accept", () => {
    const p = tempProject();
    const mid = createMilestone(p, { title: "Lit review", goal: "Survey" });
    const tid = createTask(p, {
      title: "Search transformers",
      owner: "team",
      milestoneId: mid,
    });
    expect(getPlan(p).tasks.some((t) => t.id === tid)).toBe(true);
    updateTask(p, tid, { status: "doing" });
    expect(listTasks(p, { status: "doing" })[0]?.id).toBe(tid);

    const sid = suggestPlanItem(
      p,
      "task",
      { title: "Write notes", owner: "me" },
      "scribe",
    );
    expect(acceptPlanSuggestion(p, sid)).toBe(true);
    expect(listTasks(p).some((t) => t.title === "Write notes")).toBe(true);
  });

  it("Next steps from open tasks; experiment linkage suggestion; run prefill", () => {
    const p = tempProject();
    const mid = createMilestone(p, { title: "M1" });
    createTask(p, {
      title: "Open work",
      milestoneId: mid,
      dueDate: Date.now() + 86400000,
    });
    createTask(p, { title: "Done already", status: "done" });
    const steps = nextStepsFromTasks(p);
    expect(steps).toContain("Open work");
    expect(steps).not.toContain("Done already");

    rebuildStateMd(p, { skipHistory: true });
    expect(readStateMd(p)).toContain("Open work");

    const expTask = createTask(p, {
      title: "Run exp",
      experimentIds: ["exp1"],
    });
    suggestAnalyseAfterVerdict(p, "exp1", "supported");
    expect(listTasks(p).find((t) => t.id === expTask)?.status).toBe("doing");

    const team = listTasks(p).find((t) => t.title === "Open work")!;
    updateTask(p, team.id, { owner: "team", title: "Literature review" });
    const pre = runTaskPrefill(listTasks(p).find((t) => t.id === team.id)!);
    expect(pre.preferCouncil).toBe(true);
    expect(pre.message).toContain("Literature review");
  });
});
