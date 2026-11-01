import { z } from "zod";

import { readBrief, writeBrief } from "@/lib/server/project/init";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  return Response.json({ content: readBrief(projectPath) });
}

const putSchema = z.object({
  content: z.string().max(500_000),
});

export async function PUT(request: Request) {
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
  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  writeBrief(projectPath, parsed.data.content);
  return Response.json({ ok: true });
}
