import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ONBOARDING_STATE,
  isTourStep,
  nextStep,
  prevStep,
  stepIndex,
} from "@/lib/onboarding-types";
import {
  applyOnboardingAction,
  getOnboardingState,
  isComplete,
  resetOnboarding,
} from "@/lib/server/onboarding";

describe("onboarding state machine", () => {
  beforeEach(() => {
    resetOnboarding();
  });

  it("starts at welcome", () => {
    const s = getOnboardingState();
    expect(s).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(isComplete(s)).toBe(false);
  });

  it("advances and retreats", () => {
    expect(nextStep("welcome")).toBe("connect");
    expect(nextStep("connect")).toBe("paper_keys");
    expect(nextStep("paper_keys")).toBe("project");
    expect(prevStep("connect")).toBe("welcome");
    expect(prevStep("project")).toBe("paper_keys");
    expect(stepIndex("tour_validation")).toBeGreaterThan(0);
    expect(isTourStep("tour_mode")).toBe(true);

    let s = applyOnboardingAction({ action: "next" });
    expect(s.step).toBe("connect");
    s = applyOnboardingAction({ action: "back" });
    expect(s.step).toBe("welcome");
  });

  it("skip and complete mark done", () => {
    let s = applyOnboardingAction({ action: "skip" });
    expect(isComplete(s)).toBe(true);
    expect(s.skipped).toBe(true);

    s = applyOnboardingAction({ action: "reset" });
    expect(isComplete(s)).toBe(false);
    s = applyOnboardingAction({ action: "complete" });
    expect(isComplete(s)).toBe(true);
    expect(s.skipped).toBe(false);
  });

  it("goto jumps to a step", () => {
    const s = applyOnboardingAction({ action: "goto", step: "memory" });
    expect(s.step).toBe("memory");
  });
});
