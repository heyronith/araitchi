import { describe, expect, it } from "vitest";

import {
  formatTraceabilityFooter,
  parseMarkers,
  traceSentences,
} from "@/lib/server/traceability/markers";

describe("reference markers", () => {
  it("parses paper/memory/tool/file/experiment markers", () => {
    const text =
      "Claim A [P-7]. Memory [H-12] and [D-3]. Tool [T-4]. File [F:src/util.ts#L10-24]. Exp [E-2].";
    const markers = parseMarkers(text, {
      papers: new Set(["7"]),
      memory: new Set(["H-12", "D-3"]),
      tools: new Set(["4"]),
      files: new Set(["src/util.ts"]),
      experiments: new Set(["2"]),
    });
    expect(markers.filter((m) => m.valid).length).toBe(6);
    const file = markers.find((m) => m.kind === "file");
    expect(file?.startLine).toBe(10);
    expect(file?.endLine).toBe(24);
  });

  it("flags invalid markers and computes coverage", () => {
    const text = "Good [P-1]. Bad [P-99]. Bare reasoning without markers here.";
    const traced = traceSentences(text, { papers: new Set(["1"]) });
    expect(traced.sentences.some((s) => s.invalidMarkers.length > 0)).toBe(
      true,
    );
    expect(traced.sentences.some((s) => s.modelReasoning)).toBe(true);
    expect(traced.sourcedCount).toBeGreaterThanOrEqual(1);
    expect(formatTraceabilityFooter(traced.sourcedCount, traced.total)).toMatch(
      /Traceability:/,
    );
    expect(traced.claimMap.length).toBe(traced.total);
  });
});
