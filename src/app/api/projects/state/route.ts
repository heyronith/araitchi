import { z } from "zod";

import {
  acceptStateProposal,
  dismissStateProposal,
  getStateHistoryEntry,
  listPendingStateProposals,
  listStateHistory,
  readStateMd,
  rebuildStateMd,
  writeStateSection,
  STATE_SECTIONS,
} from "@/lib/server/continuity/state";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  const url = new URL(request.url);
  const historyId = url.searchParams.get("historyId");
  if (historyId) {
    const entry = getStateHistoryEntry(projectPath, historyId);
    if (!entry) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ entry });
  }
  if (url.searchParams.get("history") === "1") {
    return Response.json({ history: listStateHistory(projectPath, 40) });
  }
  return Response.json({
    content: readStateMd(projectPath),
    history: listStateHistory(projectPath, 10),
    proposals: listPendingStateProposals(projectPath),
  });
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rebuild"),
  }),
  z.object({
    action: z.literal("writeSection"),
    section: z.enum(STATE_SECTIONS as unknown as [string, ...string[]]),
    content: z.string().max(20_000),
  }),
  z.object({
    action: z.literal("acceptProposal"),
    proposalId: z.string().min(1),
  }),
  z.object({
    action: z.literal("dismissProposal"),
    proposalId: z.string().min(1),
  }),
]);

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
  const data = parsed.data;
  if (data.action === "rebuild") {
    return Response.json({ content: rebuildStateMd(projectPath) });
  }
  if (data.action === "writeSection") {
    return Response.json({
      content: writeStateSection(
        projectPath,
        data.section as (typeof STATE_SECTIONS)[number],
        data.content,
      ),
    });
  }
  if (data.action === "acceptProposal") {
    return Response.json({
      ok: acceptStateProposal(projectPath, data.proposalId),
      content: readStateMd(projectPath),
    });
  }
  return Response.json({
    ok: dismissStateProposal(projectPath, data.proposalId),
    content: readStateMd(projectPath),
  });
}
