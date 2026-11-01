import { removeProjectFromRecents } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Ctx) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const { id } = await context.params;
  const ok = removeProjectFromRecents(id);
  if (!ok) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
