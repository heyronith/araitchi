import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";
import { listLibraryDocuments } from "@/lib/server/tools/documents/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  return Response.json({ documents: listLibraryDocuments(projectPath) });
}
