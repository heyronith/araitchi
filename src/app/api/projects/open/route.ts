import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { assertExistingDirectory } from "@/lib/server/fs-browser";
import { detectRepoPath } from "@/lib/server/project/detect-repo";
import { openProject } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  path: z.string().min(1),
  create: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    let target = path.resolve(parsed.data.path);
    if (parsed.data.create && !existsSync(target)) {
      mkdirSync(target, { recursive: true });
    }
    target = assertExistingDirectory(target);
    const project = openProject(target, { name: parsed.data.name });
    // Background memory index backfill after upgrade / first open.
    void import("@/lib/server/memory/index")
      .then((m) => m.startBackfillIfNeeded(project.path))
      .catch(() => undefined);
    return Response.json({
      project,
      repoDetected: Boolean(detectRepoPath(target)),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to open project",
      },
      { status: 400 },
    );
  }
}
