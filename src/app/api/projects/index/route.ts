import {
  getIndexProgress,
  indexProject,
} from "@/lib/server/continuity/indexer";
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
  const progress = getIndexProgress(p);
  return Response.json({
    progress: progress ?? {
      filesDone: 0,
      filesTotal: 0,
      bytesText: 0,
      exceededLimits: false,
      phase: "idle" as const,
    },
  });
}

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();
  const current = getIndexProgress(p);
  if (current?.phase === "indexing" || current?.phase === "scanning") {
    return Response.json({ started: false, progress: current });
  }
  void indexProject(p, { embed: true }).catch(() => undefined);
  return Response.json({
    started: true,
    progress: getIndexProgress(p) ?? {
      filesDone: 0,
      filesTotal: 0,
      bytesText: 0,
      exceededLimits: false,
      phase: "indexing",
    },
  });
}
