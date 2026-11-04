import { z } from "zod";

import { rebuildStateMd } from "@/lib/server/continuity/state";
import {
  acceptPlanSuggestion,
  createMilestone,
  createTask,
  dismissPlanSuggestion,
  getPlan,
  listPlanSuggestions,
  runTaskPrefill,
  suggestAnalyseAfterVerdict,
  suggestPlanItem,
  updateMilestone,
  updateTask,
  listTasks,
} from "@/lib/server/plan/service";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

function refreshNextSteps(projectPath: string) {
  try {
    rebuildStateMd(projectPath, {
      note: "plan tasks",
      skipHistory: true,
    });
  } catch {
    /* best-effort */
  }
}

export const runtime = "nodejs";

function projectPath(): string {
  return tryCurrentProjectPath() ?? ensureScratchProject().path;
}

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();
  return Response.json({
    ...getPlan(p),
    suggestions: listPlanSuggestions(p),
  });
}

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("createMilestone"),
    title: z.string().min(1),
    goal: z.string().optional(),
    targetDate: z.number().nullable().optional(),
  }),
  z.object({
    action: z.literal("updateMilestone"),
    id: z.string().min(1),
    title: z.string().optional(),
    goal: z.string().optional(),
    status: z.string().optional(),
    targetDate: z.number().nullable().optional(),
    sortOrder: z.number().optional(),
  }),
  z.object({
    action: z.literal("createTask"),
    title: z.string().min(1),
    description: z.string().optional(),
    owner: z.enum(["me", "team"]).optional(),
    status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
    dueDate: z.number().nullable().optional(),
    milestoneId: z.string().nullable().optional(),
    experimentIds: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("updateTask"),
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    owner: z.enum(["me", "team"]).optional(),
    status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
    dueDate: z.number().nullable().optional(),
    milestoneId: z.string().nullable().optional(),
    sortOrder: z.number().optional(),
    experimentIds: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("acceptSuggestion"),
    id: z.string().min(1),
  }),
  z.object({
    action: z.literal("dismissSuggestion"),
    id: z.string().min(1),
  }),
  z.object({
    action: z.literal("runTask"),
    id: z.string().min(1),
  }),
  z.object({
    action: z.literal("suggest"),
    kind: z.enum(["task", "milestone"]),
    payload: z.record(z.string(), z.unknown()),
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("suggestAfterVerdict"),
    experimentId: z.string().min(1),
    verdict: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const d = parsed.data;
  switch (d.action) {
    case "createMilestone":
      return Response.json({
        id: createMilestone(p, d),
        plan: getPlan(p),
      });
    case "updateMilestone":
      return Response.json({
        ok: updateMilestone(p, d.id, d),
        plan: getPlan(p),
      });
    case "createTask": {
      const id = createTask(p, d);
      refreshNextSteps(p);
      return Response.json({ id, plan: getPlan(p) });
    }
    case "updateTask": {
      const ok = updateTask(p, d.id, d);
      refreshNextSteps(p);
      return Response.json({ ok, plan: getPlan(p) });
    }
    case "acceptSuggestion": {
      const ok = acceptPlanSuggestion(p, d.id);
      refreshNextSteps(p);
      return Response.json({
        ok,
        plan: getPlan(p),
        suggestions: listPlanSuggestions(p),
      });
    }
    case "dismissSuggestion":
      return Response.json({
        ok: dismissPlanSuggestion(p, d.id),
        suggestions: listPlanSuggestions(p),
      });
    case "runTask": {
      const task = listTasks(p).find((t) => t.id === d.id);
      if (!task) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ ok: true, ...runTaskPrefill(task), task });
    }
    case "suggest":
      return Response.json({
        id: suggestPlanItem(p, d.kind, d.payload, d.reason ?? ""),
        suggestions: listPlanSuggestions(p),
      });
    case "suggestAfterVerdict": {
      const id = suggestAnalyseAfterVerdict(p, d.experimentId, d.verdict);
      refreshNextSteps(p);
      return Response.json({
        id,
        plan: getPlan(p),
        suggestions: listPlanSuggestions(p),
      });
    }
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
