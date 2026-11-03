import { searchChats } from "@/lib/server/continuity/search-chats";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 10;

  if (!q) {
    return Response.json({ error: "Missing q" }, { status: 400 });
  }

  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  const hits = await searchChats({ projectPath, query: q, limit });
  return Response.json({ hits });
}
