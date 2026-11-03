import path from "node:path";

import { z } from "zod";

import {
  exportResearchZip,
  importResearchZip,
} from "@/lib/server/continuity/backup";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

function projectPath(): string {
  return tryCurrentProjectPath() ?? ensureScratchProject().path;
}

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();
  const result = await exportResearchZip(p);
  return Response.json({
    ok: true,
    zipPath: result.zipPath,
    fileCount: result.fileCount,
    bytes: result.bytes,
    note: "Import overwrites notebook.db when present in the archive.",
  });
}

const postSchema = z.object({
  zipPath: z.string().min(1),
});

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const resolved = path.isAbsolute(parsed.data.zipPath)
    ? parsed.data.zipPath
    : path.join(p, parsed.data.zipPath);

  const result = await importResearchZip(p, resolved);
  return Response.json({ ok: true, ...result });
}
