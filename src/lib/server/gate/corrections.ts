import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getNotebookDb } from "@/lib/server/project/db";
import { gateCorrections } from "@/lib/server/project/schema";

import type { Stakes, TaskType } from "./taxonomy";

export type GateCorrection = {
  id: string;
  text: string;
  taskType: TaskType;
  stakes: Stakes;
  needsEvidence: boolean;
  decisionId: string | null;
  createdAt: number;
};

export function listProjectCorrections(projectPath: string): GateCorrection[] {
  try {
    return getNotebookDb(projectPath)
      .select()
      .from(gateCorrections)
      .all()
      .map((r) => ({
        id: r.id,
        text: r.text,
        taskType: r.taskType as TaskType,
        stakes: r.stakes as Stakes,
        needsEvidence: Boolean(r.needsEvidence),
        decisionId: r.decisionId,
        createdAt: r.createdAt,
      }));
  } catch {
    return [];
  }
}

export function addCorrection(
  projectPath: string,
  input: {
    text: string;
    taskType: TaskType;
    stakes: Stakes;
    needsEvidence: boolean;
    decisionId?: string | null;
  },
): GateCorrection {
  const id = nanoid();
  const createdAt = Date.now();
  getNotebookDb(projectPath)
    .insert(gateCorrections)
    .values({
      id,
      text: input.text,
      taskType: input.taskType,
      stakes: input.stakes,
      needsEvidence: input.needsEvidence,
      decisionId: input.decisionId ?? null,
      createdAt,
    })
    .run();
  return {
    id,
    text: input.text,
    taskType: input.taskType,
    stakes: input.stakes,
    needsEvidence: input.needsEvidence,
    decisionId: input.decisionId ?? null,
    createdAt,
  };
}

export function getCorrection(
  projectPath: string,
  id: string,
): GateCorrection | null {
  const row = getNotebookDb(projectPath)
    .select()
    .from(gateCorrections)
    .where(eq(gateCorrections.id, id))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    taskType: row.taskType as TaskType,
    stakes: row.stakes as Stakes,
    needsEvidence: Boolean(row.needsEvidence),
    decisionId: row.decisionId,
    createdAt: row.createdAt,
  };
}
