import { z } from "zod";

import {
  acceptInstructionSuggestion,
  dismissInstructionSuggestion,
  listInstructionSuggestions,
} from "@/lib/server/continuity/instructions";
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
  return Response.json({
    suggestions: listInstructionSuggestions(projectPath()),
  });
}

const postSchema = z.object({
  action: z.enum(["accept", "dismiss"]),
  id: z.string().min(1),
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
  const ok =
    parsed.data.action === "accept"
      ? acceptInstructionSuggestion(p, parsed.data.id)
      : dismissInstructionSuggestion(p, parsed.data.id);
  return Response.json({
    ok,
    suggestions: listInstructionSuggestions(p),
  });
}
