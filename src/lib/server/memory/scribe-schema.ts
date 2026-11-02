import { z } from "zod";

import type { RecordStatus, RecordType } from "@/lib/server/project/types";

export const RECORD_TYPES = [
  "hypothesis",
  "experiment",
  "decision",
  "paper",
  "question",
  "note",
] as const satisfies readonly RecordType[];

export const scribeCreateSchema = z.object({
  type: z.enum(RECORD_TYPES),
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(8000),
  status: z.string().max(40).optional().nullable(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

export const scribeUpdateSchema = z.object({
  id: z.string().min(1).max(64),
  status: z.string().max(40).optional().nullable(),
  appendBody: z.string().max(8000).optional(),
});

export const scribeOutputSchema = z.object({
  create: z.array(scribeCreateSchema).max(5).default([]),
  update: z.array(scribeUpdateSchema).max(5).default([]),
});

export type ScribeOutput = z.infer<typeof scribeOutputSchema>;
export type ScribeCreate = z.infer<typeof scribeCreateSchema>;
export type ScribeUpdate = z.infer<typeof scribeUpdateSchema>;

export const SCRIBE_REPAIR_PROMPT = `Your previous reply was not valid JSON for the scribe schema. Reply again with ONLY a valid JSON object (no markdown fences) with keys "create" (array, max 5) and "update" (array, max 5).`;

/** Allowed status transitions from scribe (never deletes). */
export function sanitizeScribeStatus(
  type: RecordType,
  current: RecordStatus | null | undefined,
  next: string | null | undefined,
): RecordStatus | undefined {
  if (next == null || next === "") return undefined;
  if (type === "hypothesis") {
    // Only proposed → testing from chat content
    if (next === "testing" && (!current || current === "proposed")) {
      return "testing";
    }
    if (next === "proposed" && !current) return "proposed";
    return undefined;
  }
  if (type === "experiment") {
    if (["planned", "running", "done"].includes(next)) {
      return next as RecordStatus;
    }
    return undefined;
  }
  if (type === "question") {
    if (next === "open" || next === "answered") return next;
    return undefined;
  }
  return undefined;
}

export function defaultStatusForCreate(
  type: RecordType,
  status?: string | null,
): RecordStatus {
  if (type === "hypothesis") {
    if (status === "testing") return "testing";
    return "proposed";
  }
  if (type === "experiment") {
    if (status === "running" || status === "done") return status;
    return "planned";
  }
  if (type === "question") {
    if (status === "answered") return "answered";
    return "open";
  }
  return null;
}
