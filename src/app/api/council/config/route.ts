import { z } from "zod";

import {
  resolveBalancedPreset,
  resolveBudgetPreset,
  validateCouncilMembers,
} from "@/lib/server/council/presets";
import { listModels } from "@/lib/server/models";
import {
  getChatMode,
  getCouncilConfig,
  setChatMode,
  setCouncilConfig,
} from "@/lib/server/project/settings";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";
import { MODEL_ID_RE } from "@/lib/chat/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  let config = getCouncilConfig(projectPath);
  const catalog = await listModels();

  if (config.members.length < 3) {
    const preset =
      config.preset === "budget"
        ? resolveBudgetPreset(catalog)
        : resolveBalancedPreset(catalog);
    config = setCouncilConfig(projectPath, {
      members: preset.members,
      synthesizer: preset.synthesizer,
      preset: config.preset === "custom" ? "balanced" : config.preset,
    });
  }

  const validation = validateCouncilMembers(config.members);
  return Response.json({
    config,
    mode: getChatMode(projectPath),
    labWarning: validation.labWarning ?? null,
  });
}

const putSchema = z.object({
  members: z.array(z.string().regex(MODEL_ID_RE)).min(3).max(10).optional(),
  synthesizer: z.string().regex(MODEL_ID_RE).optional(),
  maxOutputTokensPerMember: z.number().int().min(256).max(32_000).optional(),
  budgetCapUsd: z.number().min(0.0001).max(100).optional(),
  memberTimeoutSec: z.number().int().min(10).max(600).optional(),
  preset: z.enum(["balanced", "budget", "custom"]).optional(),
  mode: z.enum(["solo", "council"]).optional(),
  applyPreset: z.enum(["balanced", "budget"]).optional(),
});

export async function PUT(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  if (parsed.data.mode) {
    setChatMode(projectPath, parsed.data.mode);
  }

  const catalog = await listModels();
  let patch = { ...parsed.data };
  delete (patch as { mode?: unknown }).mode;
  delete (patch as { applyPreset?: unknown }).applyPreset;

  if (parsed.data.applyPreset === "balanced") {
    const p = resolveBalancedPreset(catalog);
    patch = {
      ...patch,
      members: p.members,
      synthesizer: p.synthesizer,
      preset: "balanced",
    };
  } else if (parsed.data.applyPreset === "budget") {
    const p = resolveBudgetPreset(catalog);
    patch = {
      ...patch,
      members: p.members,
      synthesizer: p.synthesizer,
      preset: "budget",
    };
  }

  if (patch.members) {
    const v = validateCouncilMembers(patch.members);
    if (!v.ok) {
      return Response.json({ error: v.error }, { status: 400 });
    }
  }

  const config = setCouncilConfig(projectPath, patch);
  const validation = validateCouncilMembers(config.members);
  return Response.json({
    config,
    mode: getChatMode(projectPath),
    labWarning: validation.labWarning ?? null,
  });
}
