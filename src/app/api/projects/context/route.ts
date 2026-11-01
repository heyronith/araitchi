import { listPinnedRecords } from "@/lib/server/project/records";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ pinnedCount: 0, hasBrief: false });
  }
  const pinned = listPinnedRecords(projectPath);
  return Response.json({
    pinnedCount: pinned.length,
    hasBrief: true,
  });
}
