import { z } from "zod";

import {
  acceptSuggestion,
  dismissSuggestion,
  listPendingSuggestions,
  undoScribeBatch,
} from "@/lib/server/memory/scribe";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  return Response.json({
    suggestions: listPendingSuggestions(projectPath),
  });
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("undo"), batchId: z.string().min(1) }),
  z.object({
    action: z.literal("accept"),
    suggestionId: z.string().min(1),
  }),
  z.object({
    action: z.literal("dismiss"),
    suggestionId: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (parsed.data.action === "undo") {
    const ok = undoScribeBatch(projectPath, parsed.data.batchId);
    return Response.json({ ok });
  }
  if (parsed.data.action === "accept") {
    const rec = acceptSuggestion(projectPath, parsed.data.suggestionId);
    return Response.json({ ok: Boolean(rec), record: rec });
  }
  const ok = dismissSuggestion(projectPath, parsed.data.suggestionId);
  return Response.json({ ok });
}
