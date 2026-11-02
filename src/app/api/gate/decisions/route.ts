import { z } from "zod";

import { addCorrection } from "@/lib/server/gate/corrections";
import {
  getGateDecision,
  listGateDecisions,
  setDecisionCorrection,
} from "@/lib/server/gate/decisions";
import {
  actionForTaskType,
  isTaskType,
  TASK_TYPES,
  type Stakes,
} from "@/lib/server/gate/taxonomy";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? undefined;
  const taskType = url.searchParams.get("taskType") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? 50);
  return Response.json({
    decisions: listGateDecisions(projectPath, {
      action: action as never,
      taskType: taskType as never,
      limit: Number.isFinite(limit) ? limit : 50,
    }),
  });
}

const correctSchema = z.object({
  decisionId: z.string().min(1),
  taskType: z.enum(TASK_TYPES),
  stakes: z.enum(["low", "medium", "high"]).optional(),
  needsEvidence: z.boolean().optional(),
  text: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = correctSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const decision = getGateDecision(projectPath, parsed.data.decisionId);
  if (!decision) {
    return Response.json({ error: "Decision not found" }, { status: 404 });
  }
  if (!isTaskType(parsed.data.taskType)) {
    return Response.json({ error: "Bad task type" }, { status: 400 });
  }
  const stakes = (parsed.data.stakes ?? decision.stakes) as Stakes;
  const needsEvidence = parsed.data.needsEvidence ?? decision.needsEvidence;
  const text = parsed.data.text ?? `(correction for ${decision.messageId})`;
  const corr = addCorrection(projectPath, {
    text,
    taskType: parsed.data.taskType,
    stakes,
    needsEvidence,
    decisionId: decision.id,
  });
  setDecisionCorrection(
    projectPath,
    decision.id,
    `${parsed.data.taskType} → ${actionForTaskType(parsed.data.taskType)}`,
  );
  return Response.json({ ok: true, correction: corr });
}
