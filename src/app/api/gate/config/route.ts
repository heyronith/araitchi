import { z } from "zod";

import { getGateSettings, setGateSettings } from "@/lib/server/gate/settings";
import { TASK_TYPES } from "@/lib/server/gate/taxonomy";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const patchSchema = z.object({
  knnThreshold: z.number().min(0).max(1).optional(),
  probeAgreementThreshold: z.number().min(0).max(1).optional(),
  classifierModel: z.string().min(1).max(200).optional(),
  probeModels: z.tuple([z.string(), z.string()]).optional(),
  alwaysCouncil: z.array(z.enum(TASK_TYPES)).optional(),
  knnK: z.number().int().min(1).max(31).optional(),
  budgetBehaviour: z.enum(["block", "warn", "allow"]).optional(),
});

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  return Response.json({ settings: getGateSettings(projectPath) });
}

export async function PATCH(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  return Response.json({
    settings: setGateSettings(projectPath, parsed.data),
  });
}
