import { z } from "zod";

import {
  editExperiment,
  getExperiment,
} from "@/lib/server/experiments/service";
import { experimentDraftSchema } from "@/lib/server/experiments/types";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const { id } = await ctx.params;
  const experiment = getExperiment(projectPath, id);
  if (!experiment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ experiment });
}

const patchSchema = experimentDraftSchema.partial().extend({
  hypothesisIds: z.array(z.string()).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const experiment = editExperiment(projectPath, id, parsed.data);
    return Response.json({ experiment });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 },
    );
  }
}
