import { describe, expect, it } from "vitest";

import {
  buildLongProjectFixture,
  normalizeRecallText,
  scoreRecallAnswer,
  summarizeRecallByKind,
} from "@/lib/server/evals/recall-scorer";

describe("recall scorer", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeRecallText("  Hello, World!  ")).toBe("hello world");
  });

  it("scores semantic includes", () => {
    const ctx =
      "Relevant memory\n- Note: LATEST-primary_metric-R6 value=166-primary_metric.";
    expect(
      scoreRecallAnswer(
        ctx,
        "LATEST-primary_metric-R6 value=166-primary_metric.",
        "semantic",
      ),
    ).toBe(true);
  });

  it("scores exact mode strictly", () => {
    expect(scoreRecallAnswer("alpha", "alpha", "exact")).toBe(true);
    expect(scoreRecallAnswer("alpha beta", "alpha", "exact")).toBe(false);
  });

  it("fixture includes all question kinds", () => {
    const f = buildLongProjectFixture();
    const kinds = new Set(f.questions.map((q) => q.kind));
    expect(kinds.has("static")).toBe(true);
    expect(kinds.has("changed_later")).toBe(true);
    expect(kinds.has("oldest")).toBe(true);
    expect(kinds.has("distractor_resistance")).toBe(true);
    const changed = f.questions.filter((q) => q.kind === "changed_later");
    expect(changed.every((q) => (q.superseded?.length ?? 0) > 0)).toBe(true);
  });

  it("summarizes by kind", () => {
    const s = summarizeRecallByKind([
      { kind: "static", ok: true },
      { kind: "static", ok: false },
      { kind: "changed_later", ok: true },
    ]);
    expect(s.static.pct).toBe(50);
    expect(s.changed_later.pct).toBe(100);
  });
});
