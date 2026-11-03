import { buildProjectSystemContext } from "@/lib/server/project/context";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({
      pinnedCount: 0,
      relevantCount: 0,
      totalTokens: 0,
      hasBrief: false,
      items: [],
      vectorUsed: false,
    });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const chatId = url.searchParams.get("chatId") ?? undefined;
  const ctx = await buildProjectSystemContext(projectPath, {
    userMessage: q,
    chatId: chatId ?? undefined,
  });

  return Response.json({
    pinnedCount: ctx.pinnedCount,
    relevantCount: ctx.relevantCount,
    totalTokens: ctx.totalTokens,
    briefTokens: ctx.briefTokens,
    hasBrief: true,
    items: ctx.items,
    vectorUsed: ctx.vectorUsed,
    layerIds: ctx.layerIds,
    handoffNote: ctx.handoffNote,
  });
}
