import { z } from "zod";

import {
  ONBOARDING_STEPS,
  applyOnboardingAction,
  getOnboardingState,
  isComplete,
} from "@/lib/server/onboarding";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("next") }),
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("reset") }),
  z.object({
    action: z.literal("goto"),
    step: z.enum(ONBOARDING_STEPS),
  }),
]);

export async function GET() {
  const state = getOnboardingState();
  return Response.json({
    state,
    isComplete: isComplete(state),
    steps: ONBOARDING_STEPS,
  });
}

export async function PATCH(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const state = applyOnboardingAction(parsed.data);
  return Response.json({
    state,
    isComplete: isComplete(state),
    steps: ONBOARDING_STEPS,
  });
}
