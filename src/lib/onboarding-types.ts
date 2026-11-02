/** Shared onboarding types (safe for client + server). */

export const ONBOARDING_STEPS = [
  "welcome",
  "connect",
  "paper_keys",
  "project",
  "preset",
  "memory",
  "tour_mode",
  "tour_memory",
  "tour_tools",
  "tour_validation",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingState = {
  completed: boolean;
  skipped: boolean;
  step: OnboardingStep;
  completedAt: number | null;
};

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completed: false,
  skipped: false,
  step: "welcome",
  completedAt: null,
};

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return (
    typeof value === "string" &&
    (ONBOARDING_STEPS as readonly string[]).includes(value)
  );
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const i = stepIndex(step);
  if (i < 0 || i >= ONBOARDING_STEPS.length - 1) return null;
  return ONBOARDING_STEPS[i + 1]!;
}

export function prevStep(step: OnboardingStep): OnboardingStep | null {
  const i = stepIndex(step);
  if (i <= 0) return null;
  return ONBOARDING_STEPS[i - 1]!;
}

export function isTourStep(step: OnboardingStep): boolean {
  return step.startsWith("tour_");
}
