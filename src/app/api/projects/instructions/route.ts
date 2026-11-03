import { z } from "zod";

import {
  getRoleOverride,
  loadRolePrompt,
  resetRoleOverride,
  setRoleOverride,
  type InstructionRole,
} from "@/lib/server/continuity/instructions";
import { loadPrompt } from "@/lib/server/prompts/load";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const ROLES = [
  "council_member",
  "synthesizer",
  "scribe",
  "evidence",
  "experiment_designer",
  "results_interpreter",
] as const;

const ROLE_PROMPT_FILES: Record<(typeof ROLES)[number], string> = {
  council_member: "council-member.md",
  synthesizer: "council-synthesizer.md",
  scribe: "scribe.md",
  evidence: "evidence.md",
  experiment_designer: "merge/experiment_design.md",
  results_interpreter: "merge/results_interpretation.md",
};

function projectPath(): string {
  return tryCurrentProjectPath() ?? ensureScratchProject().path;
}

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();
  const roles: Record<
    string,
    { override: string | null; default: string; effective: string }
  > = {};
  for (const role of ROLES) {
    const override = getRoleOverride(p, role);
    const def = loadPrompt(ROLE_PROMPT_FILES[role]);
    roles[role] = {
      override,
      default: def,
      effective: loadRolePrompt(p, role),
    };
  }
  return Response.json({ roles });
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setRole"),
    role: z.enum(ROLES),
    content: z.string().max(50_000),
  }),
  z.object({
    action: z.literal("resetRole"),
    role: z.enum(ROLES),
  }),
]);

export async function PATCH(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();
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
  const role = parsed.data.role as Exclude<InstructionRole, "default">;
  if (parsed.data.action === "resetRole") {
    resetRoleOverride(p, role);
  } else {
    setRoleOverride(p, role, parsed.data.content);
  }
  return Response.json({
    role,
    override: getRoleOverride(p, role),
    effective: loadRolePrompt(p, role),
  });
}
