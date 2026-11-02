import "server-only";

import {
  DEFAULT_ONBOARDING_STATE,
  isOnboardingStep,
  nextStep,
  prevStep,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/onboarding-types";
import { getSetting, setSetting } from "@/lib/server/settings";

export {
  DEFAULT_ONBOARDING_STATE,
  ONBOARDING_STEPS,
  isOnboardingStep,
  isTourStep,
  nextStep,
  prevStep,
  stepIndex,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/onboarding-types";

const SETTING_KEY = "onboarding";

function normalize(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_ONBOARDING_STATE };
  }
  const o = raw as Record<string, unknown>;
  const step = isOnboardingStep(o.step) ? o.step : "welcome";
  return {
    completed: o.completed === true,
    skipped: o.skipped === true,
    step,
    completedAt:
      typeof o.completedAt === "number" && Number.isFinite(o.completedAt)
        ? o.completedAt
        : null,
  };
}

/**
 * When ARAITCHI_ONBOARDING_COMPLETE=1 and no stored state yet, treat as done
 * so e2e / CI shells are not blocked. Explicit reset clears this path.
 */
function envDefaultComplete(): boolean {
  return process.env.ARAITCHI_ONBOARDING_COMPLETE === "1";
}

export function getOnboardingState(): OnboardingState {
  const stored = getSetting<unknown | null>(SETTING_KEY, null);
  if (stored != null) {
    return normalize(stored);
  }
  if (envDefaultComplete()) {
    return {
      completed: true,
      skipped: true,
      step: "tour_validation",
      completedAt: Date.now(),
    };
  }
  return { ...DEFAULT_ONBOARDING_STATE };
}

export function isComplete(
  state: OnboardingState = getOnboardingState(),
): boolean {
  return state.completed === true;
}

function persist(state: OnboardingState): OnboardingState {
  setSetting(SETTING_KEY, state);
  return state;
}

export function setOnboardingStep(step: OnboardingStep): OnboardingState {
  const cur = getOnboardingState();
  if (cur.completed) return cur;
  return persist({ ...cur, step, completed: false });
}

export function advanceOnboarding(): OnboardingState {
  const cur = getOnboardingState();
  if (cur.completed) return cur;
  const n = nextStep(cur.step);
  if (!n) {
    return completeOnboarding({ skipped: false });
  }
  return persist({ ...cur, step: n, completed: false });
}

export function retreatOnboarding(): OnboardingState {
  const cur = getOnboardingState();
  if (cur.completed) return cur;
  const p = prevStep(cur.step);
  if (!p) return cur;
  return persist({ ...cur, step: p, completed: false });
}

export function skipOnboarding(): OnboardingState {
  return completeOnboarding({ skipped: true });
}

export function completeOnboarding(opts?: {
  skipped?: boolean;
}): OnboardingState {
  return persist({
    completed: true,
    skipped: opts?.skipped === true,
    step: "tour_validation",
    completedAt: Date.now(),
  });
}

export function resetOnboarding(): OnboardingState {
  return persist({ ...DEFAULT_ONBOARDING_STATE });
}

export type OnboardingAction =
  | { action: "next" }
  | { action: "back" }
  | { action: "skip" }
  | { action: "complete" }
  | { action: "reset" }
  | { action: "goto"; step: OnboardingStep };

export function applyOnboardingAction(
  input: OnboardingAction,
): OnboardingState {
  switch (input.action) {
    case "next":
      return advanceOnboarding();
    case "back":
      return retreatOnboarding();
    case "skip":
      return skipOnboarding();
    case "complete":
      return completeOnboarding({ skipped: false });
    case "reset":
      return resetOnboarding();
    case "goto":
      return setOnboardingStep(input.step);
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}
