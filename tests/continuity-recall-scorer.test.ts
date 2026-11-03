import { describe, expect, it } from "vitest";

import {
  normalizeRecallText,
  scoreRecallAnswer,
} from "@/lib/server/evals/recall-scorer";

describe("recall scorer", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeRecallText("  Hello, World!  ")).toBe("hello world");
  });

  it("scores semantic includes", () => {
    const ctx = "Relevant memory\n- Note: Latest primary_metric is VALUE-4-0-58.";
    expect(
      scoreRecallAnswer(
        ctx,
        "Latest primary_metric is VALUE-4-0-58.",
        "semantic",
      ),
    ).toBe(true);
  });

  it("scores exact mode strictly", () => {
    expect(scoreRecallAnswer("alpha", "alpha", "exact")).toBe(true);
    expect(scoreRecallAnswer("alpha beta", "alpha", "exact")).toBe(false);
  });

  it("uses token overlap for partial semantic match", () => {
    const retrieved =
      "The experiment used sample size VALUE-2-1-34 across three cohorts.";
    expect(
      scoreRecallAnswer(retrieved, "sample size VALUE-2-1-34", "semantic"),
    ).toBe(true);
  });
});
