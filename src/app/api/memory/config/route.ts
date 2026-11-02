import { z } from "zod";

import {
  getEmbedderStatus,
  getEmbedder,
  resolveEmbeddingModelId,
} from "@/lib/server/memory/embedder";
import { getIndexProgress, rebuildIndex } from "@/lib/server/memory/index";
import {
  getMemorySettings,
  setMemorySettings,
} from "@/lib/server/memory/settings";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const patchSchema = z.object({
  embeddingModel: z.string().optional(),
  scribeEnabled: z.boolean().optional(),
  scribeRequireReview: z.boolean().optional(),
  scribeModel: z.string().nullable().optional(),
  memoryTokens: z.number().int().min(1000).max(20000).optional(),
  rebuild: z.boolean().optional(),
});

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  return Response.json({
    settings: getMemorySettings(projectPath),
    embedder: getEmbedderStatus(),
    index: getIndexProgress(projectPath),
  });
}

export async function PATCH(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const prev = getMemorySettings(projectPath);
  const next = setMemorySettings(projectPath, {
    embeddingModel: parsed.data.embeddingModel
      ? resolveEmbeddingModelId(parsed.data.embeddingModel)
      : undefined,
    scribeEnabled: parsed.data.scribeEnabled,
    scribeRequireReview: parsed.data.scribeRequireReview,
    scribeModel: parsed.data.scribeModel,
    memoryTokens: parsed.data.memoryTokens,
  });

  if (
    parsed.data.embeddingModel &&
    next.embeddingModel !== prev.embeddingModel
  ) {
    // Model switch → full re-index in background
    void getEmbedder(next.embeddingModel)
      .then(() => rebuildIndex(projectPath))
      .catch(() => undefined);
  }

  if (parsed.data.rebuild) {
    void rebuildIndex(projectPath).catch(() => undefined);
  }

  return Response.json({
    settings: next,
    embedder: getEmbedderStatus(),
    index: getIndexProgress(projectPath),
  });
}
