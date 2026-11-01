import { z } from "zod";

import {
  getRecord,
  restoreRecord,
  softDeleteRecord,
  updateRecord,
} from "@/lib/server/project/records";
import type { RecordStatus, RecordType } from "@/lib/server/project/types";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const RECORD_TYPES = [
  "hypothesis",
  "experiment",
  "decision",
  "paper",
  "question",
  "note",
] as const;

export async function GET(request: Request, context: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const { id } = await context.params;
  const record = getRecord(projectPath, id);
  if (!record || record.deletedAt) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ record });
}

const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  body: z.string().max(500_000).optional(),
  status: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  type: z.enum(RECORD_TYPES).optional(),
  restore: z.boolean().optional(),
});

export async function PATCH(request: Request, context: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const { id } = await context.params;

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

  if (parsed.data.restore) {
    const record = restoreRecord(projectPath, id);
    if (!record) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ record });
  }

  const { restore, status, ...rest } = parsed.data;
  void restore;
  const record = updateRecord(projectPath, id, {
    ...rest,
    status: status !== undefined ? (status as RecordStatus) : undefined,
    type: rest.type as RecordType | undefined,
  });
  if (!record) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ record });
}

export async function DELETE(request: Request, context: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const { id } = await context.params;
  const record = softDeleteRecord(projectPath, id);
  if (!record) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ record });
}
