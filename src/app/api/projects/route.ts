import {
  getCurrentOpenedProject,
  listRecentProjects,
} from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const current = getCurrentOpenedProject();
  const recent = listRecentProjects();
  return Response.json({ current, recent });
}
