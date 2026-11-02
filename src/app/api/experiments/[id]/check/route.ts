import { runCheckResults } from "@/lib/server/experiments/service";
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
  let skipInterpretation = false;
  try {
    const json = (await request.json().catch(() => ({}))) as {
      skipInterpretation?: boolean;
    };
    skipInterpretation = Boolean(json.skipInterpretation);
  } catch {
    // empty body ok
  }
  try {
    const experiment = await runCheckResults({
      projectPath,
      id,
      skipInterpretation:
        skipInterpretation || process.env.ARAITCHI_FAKE_EMBEDDINGS === "1",
      signal: request.signal,
    });
    return Response.json({ experiment });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Check failed" },
      { status: 400 },
    );
  }
}
