import { z } from "zod";

import { overrideVerdict } from "@/lib/server/experiments/service";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  verdict: z.enum(["supported", "refuted", "inconclusive", "replicated"]),
  reason: z.string().min(1).max(4000),
});

export async function POST(request: Request, ctx: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Override requires verdict and a written reason" },
      { status: 400 },
    );
  }
  try {
    const experiment = overrideVerdict({
      projectPath,
      id,
      verdict: parsed.data.verdict,
      reason: parsed.data.reason,
    });
    return Response.json({ experiment });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Override failed" },
      { status: 400 },
    );
  }
}
