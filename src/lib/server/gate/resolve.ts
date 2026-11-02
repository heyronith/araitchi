import "server-only";

import type { ChatMode } from "@/lib/server/council/types";

import { classifyRequest, type Classification } from "./classify";
import type { GateAction } from "./taxonomy";

/**
 * Resolve the gate action for a request.
 * `forceAction` (re-run chip) overrides the classified action but keeps metadata.
 */
export async function resolveGate(input: {
  projectPath: string;
  text: string;
  mode: ChatMode | "auto";
  apiKey: string;
  forceAction?: GateAction | null;
  signal?: AbortSignal;
}): Promise<Classification> {
  const classification = await classifyRequest({
    projectPath: input.projectPath,
    text: input.text,
    mode: input.mode,
    apiKey: input.apiKey,
    signal: input.signal,
  });

  if (input.forceAction) {
    return {
      ...classification,
      action: input.forceAction,
      reason: `${classification.reason} · re-run forced as ${input.forceAction}`,
      layer: classification.layer,
    };
  }
  return classification;
}
