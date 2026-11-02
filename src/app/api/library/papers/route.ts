import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";
import {
  paperSchema,
  savePaperToLibrary,
} from "@/lib/server/tools/documents/papers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = paperSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const { record, id } = savePaperToLibrary(projectPath, parsed.data);
  return Response.json({ id, record }, { status: 201 });
}
