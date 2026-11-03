import { z } from "zod";

import {
  applyMerge,
  archiveStaleQuestions,
  findDuplicateClusters,
  listMergeProposals,
  proposeMerges,
} from "@/lib/server/continuity/tidy";
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
  const clusters = await findDuplicateClusters(p);
  return Response.json({
    clusters,
    proposals: listMergeProposals(p),
  });
}

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose"),
    threshold: z.number().min(0.5).max(1).optional(),
  }),
  z.object({
    action: z.literal("merge"),
    keepId: z.string().min(1),
    absorbIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    action: z.literal("archive"),
    days: z.number().int().min(1).max(3650).optional(),
  }),
]);

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

  if (parsed.data.action === "propose") {
    const proposals = await proposeMerges(p, parsed.data.threshold ?? 0.92);
    return Response.json({ proposals });
  }
  if (parsed.data.action === "merge") {
    const result = await applyMerge(
      p,
      parsed.data.keepId,
      parsed.data.absorbIds,
    );
    return Response.json(result);
  }
  const archived = archiveStaleQuestions(p, parsed.data.days ?? 60);
  return Response.json(archived);
}
