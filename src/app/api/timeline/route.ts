import { buildTimeline } from "@/lib/server/experiments/timeline";
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
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const events = buildTimeline(projectPath, { status: status ?? undefined });
  return Response.json({ events });
}
