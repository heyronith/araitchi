import { z } from "zod";

import { requestReplication } from "@/lib/server/experiments/service";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  newSeeds: z.array(z.number().int()).min(1).max(100).optional(),
  dataset: z.string().max(8000).optional(),
});

export async function POST(request: Request, ctx: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const { id } = await ctx.params;
  let json: unknown = {};
  try {
    json = await request.json();
  } catch {
    // empty ok
  }
  const parsed = schema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const experiment = requestReplication(projectPath, id, parsed.data);
    return Response.json({ experiment }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Replication failed" },
      { status: 400 },
    );
  }
}
