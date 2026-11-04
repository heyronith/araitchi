import { z } from "zod";

import {
  acceptPlanSuggestion,
  createMilestone,
  createTask,
  dismissPlanSuggestion,
  getPlan,
  listPlanSuggestions,
  runTaskPrefill,
  updateMilestone,
  updateTask,
  listTasks,
} from "@/lib/server/plan/service";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

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
    case "createTask":
      return Response.json({ id: createTask(p, d), plan: getPlan(p) });
    case "updateTask":
      return Response.json({
        ok: updateTask(p, d.id, d),
        plan: getPlan(p),
      });
    case "acceptSuggestion":
      return Response.json({
        ok: acceptPlanSuggestion(p, d.id),
        plan: getPlan(p),
        suggestions: listPlanSuggestions(p),
      });
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
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
