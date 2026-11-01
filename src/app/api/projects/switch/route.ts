import { z } from "zod";

import { switchToProject } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  id: z.string().min(1),
});

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const project = switchToProject(parsed.data.id);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  return Response.json({ project });
}
