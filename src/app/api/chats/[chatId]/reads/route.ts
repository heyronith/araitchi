import { getReadCompleteness } from "@/lib/server/continuity/read-file";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ chatId: string }> },
) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const { chatId } = await ctx.params;
  const url = new URL(request.url);
  const messageId = url.searchParams.get("messageId");
  if (!messageId) {
    return Response.json({ error: "Missing messageId" }, { status: 400 });
  }
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  const files = getReadCompleteness(projectPath, chatId, messageId);
  return Response.json({ files });
}
