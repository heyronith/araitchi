import { z } from "zod";

import {
  designAndCreateExperiment,
  listExperiments,
} from "@/lib/server/experiments/service";
import { experimentDraftSchema } from "@/lib/server/experiments/types";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const experiments = listExperiments(projectPath).filter((e) =>
    status && status !== "all" ? e.status === status : true,
  );
  return Response.json({ experiments });
}

const postSchema = z.object({
  hypothesisId: z.string().optional(),
  prompt: z.string().max(20_000).optional(),
  draft: experimentDraftSchema.optional(),
});

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath();
  if (!projectPath) {
    return Response.json({ error: "No project open" }, { status: 400 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const experiment = await designAndCreateExperiment({
      projectPath,
      hypothesisId: parsed.data.hypothesisId,
      prompt: parsed.data.prompt,
      draft: parsed.data.draft,
      signal: request.signal,
    });
    return Response.json({ experiment }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Design failed" },
      { status: 500 },
    );
  }
}
