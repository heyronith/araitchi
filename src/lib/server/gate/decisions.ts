import "server-only";

import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getNotebookDb } from "@/lib/server/project/db";
import { gateDecisions } from "@/lib/server/project/schema";

import type { Classification } from "./classify";
import type { GateAction, GateLayer, Stakes, TaskType } from "./taxonomy";

export type GateDecisionRow = {
  id: string;
  messageId: string;
  chatId: string;
  inputHash: string;
  layer: GateLayer;
  taskType: TaskType;
  stakes: Stakes;
  needsEvidence: boolean;
  confidence: number;
  action: GateAction;
  models: string[];
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  probeAgreement: number | null;
  escalated: boolean;
  userCorrection: string | null;
  reason: string;
  latencyMs: number;
  createdAt: number;
};

function rowToDecision(r: typeof gateDecisions.$inferSelect): GateDecisionRow {
  let models: string[] = [];
  try {
    models = JSON.parse(r.models) as string[];
  } catch {
    models = [];
  }
  return {
    id: r.id,
    messageId: r.messageId,
    chatId: r.chatId,
    inputHash: r.inputHash,
    layer: r.layer as GateLayer,
    taskType: r.taskType as TaskType,
    stakes: r.stakes as Stakes,
    needsEvidence: Boolean(r.needsEvidence),
    confidence: r.confidence,
    action: r.action as GateAction,
    models,
    estimatedCostUsd: r.estimatedCostUsd,
    actualCostUsd: r.actualCostUsd,
    probeAgreement: r.probeAgreement,
    escalated: Boolean(r.escalated),
    userCorrection: r.userCorrection,
    reason: r.reason,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt,
  };
}

export function insertGateDecision(input: {
  projectPath: string;
  messageId: string;
  chatId: string;
  classification: Classification;
  models?: string[];
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  probeAgreement?: number | null;
  escalated?: boolean;
}): GateDecisionRow {
  const id = nanoid();
  const createdAt = Date.now();
  getNotebookDb(input.projectPath)
    .insert(gateDecisions)
    .values({
      id,
      messageId: input.messageId,
      chatId: input.chatId,
      inputHash: input.classification.inputHash,
      layer: input.classification.layer,
      taskType: input.classification.taskType,
      stakes: input.classification.stakes,
      needsEvidence: input.classification.needsEvidence,
      confidence: input.classification.confidence,
      action: input.classification.action,
      models: JSON.stringify(input.models ?? []),
      estimatedCostUsd: input.estimatedCostUsd ?? null,
      actualCostUsd: input.actualCostUsd ?? null,
      probeAgreement: input.probeAgreement ?? null,
      escalated: input.escalated ?? false,
      userCorrection: null,
      reason: input.classification.reason,
      latencyMs: input.classification.latencyMs,
      createdAt,
    })
    .run();
  return getGateDecision(input.projectPath, id)!;
}

export function updateGateDecision(
  projectPath: string,
  id: string,
  patch: Partial<{
    actualCostUsd: number | null;
    probeAgreement: number | null;
    escalated: boolean;
    models: string[];
    action: GateAction;
    userCorrection: string | null;
  }>,
): GateDecisionRow | null {
  const existing = getGateDecision(projectPath, id);
  if (!existing) return null;
  getNotebookDb(projectPath)
    .update(gateDecisions)
    .set({
      actualCostUsd:
        patch.actualCostUsd !== undefined
          ? patch.actualCostUsd
          : existing.actualCostUsd,
      probeAgreement:
        patch.probeAgreement !== undefined
          ? patch.probeAgreement
          : existing.probeAgreement,
      escalated:
        patch.escalated !== undefined ? patch.escalated : existing.escalated,
      models:
        patch.models !== undefined
          ? JSON.stringify(patch.models)
          : JSON.stringify(existing.models),
      action: patch.action ?? existing.action,
      userCorrection:
        patch.userCorrection !== undefined
          ? patch.userCorrection
          : existing.userCorrection,
    })
    .where(eq(gateDecisions.id, id))
    .run();
  return getGateDecision(projectPath, id);
}

export function getGateDecision(
  projectPath: string,
  id: string,
): GateDecisionRow | null {
  const row = getNotebookDb(projectPath)
    .select()
    .from(gateDecisions)
    .where(eq(gateDecisions.id, id))
    .get();
  return row ? rowToDecision(row) : null;
}

export function getGateDecisionForMessage(
  projectPath: string,
  messageId: string,
): GateDecisionRow | null {
  const row = getNotebookDb(projectPath)
    .select()
    .from(gateDecisions)
    .where(eq(gateDecisions.messageId, messageId))
    .get();
  return row ? rowToDecision(row) : null;
}

export function listGateDecisions(
  projectPath: string,
  opts?: {
    action?: GateAction;
    taskType?: TaskType;
    limit?: number;
  },
): GateDecisionRow[] {
  let rows = getNotebookDb(projectPath)
    .select()
    .from(gateDecisions)
    .orderBy(desc(gateDecisions.createdAt))
    .all()
    .map(rowToDecision);
  if (opts?.action) rows = rows.filter((r) => r.action === opts.action);
  if (opts?.taskType) rows = rows.filter((r) => r.taskType === opts.taskType);
  return rows.slice(0, opts?.limit ?? 100);
}

export function setDecisionCorrection(
  projectPath: string,
  decisionId: string,
  correctionLabel: string,
): GateDecisionRow | null {
  return updateGateDecision(projectPath, decisionId, {
    userCorrection: correctionLabel,
  });
}
