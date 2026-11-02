import { lockExperiment } from "@/lib/server/experiments/service";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const experiment = await lockExperiment(projectPath, id);
    return Response.json({ experiment });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Lock failed" },
      { status: 400 },
    );
  }
}
