import { z } from "zod";

import { estimateCouncilCost } from "@/lib/server/council/estimate";
import { listModels } from "@/lib/server/models";
import { buildProjectSystemContext } from "@/lib/server/project/context";
import {
  getCouncilConfig,
  setCouncilConfig,
} from "@/lib/server/project/settings";
import {
  resolveBalancedPreset,
  resolveBudgetPreset,
} from "@/lib/server/council/presets";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  contextChars: z.number().int().nonnegative().optional(),
  messagesText: z.string().optional(),
});

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let json: unknown = {};
  try {
    json = await request.json();
  } catch {
    // empty ok
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

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
      synthesizer: preset.synthesizer || config.synthesizer,
      preset: config.preset === "custom" ? "balanced" : config.preset,
    });
  }

  const ctx = await buildProjectSystemContext(projectPath);
  const contextChars =
    parsed.data.contextChars ??
    ctx.systemText.length + (parsed.data.messagesText?.length ?? 0);

  const estimate = estimateCouncilCost({
    contextChars,
    config,
    catalog,
  });

  return Response.json({
    estimate,
    config,
    overBudget: estimate.totalHighUsd > config.budgetCapUsd,
  });
}
