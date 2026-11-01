import { z } from "zod";

import { createRecord, listRecords } from "@/lib/server/project/records";
import type { RecordStatus, RecordType } from "@/lib/server/project/types";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const RECORD_TYPES = [
  "hypothesis",
  "experiment",
  "decision",
  "paper",
  "question",
  "note",
] as const;

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") as RecordType | null;
  const query = url.searchParams.get("q") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  const records = listRecords(projectPath, {
    type: type && RECORD_TYPES.includes(type) ? type : undefined,
    query,
    status: status || undefined,
  });
  return Response.json({ records });
}

const createSchema = z.object({
  type: z.enum(RECORD_TYPES),
  title: z.string().min(1).max(500),
  body: z.string().max(500_000),
  status: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  source: z.string().min(1).max(200),
  sourceChatId: z.string().nullable().optional(),
  sourceMessageId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const record = createRecord(projectPath, {
    ...parsed.data,
    status: (parsed.data.status as RecordStatus) ?? null,
  });
  return Response.json({ record }, { status: 201 });
}
