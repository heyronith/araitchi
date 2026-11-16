import { describe, expect, it } from "vitest";

import {
  claimEntailedByQuote,
  evidenceQuoteInSource,
  evidenceTag,
  extractEvidenceQuote,
  stripEvidenceTags,
} from "@/lib/server/memory/evidence";

describe("evidence quotes", () => {
  it("matches normalised whitespace/case", () => {
    expect(
      evidenceQuoteInSource(
        "Widget Friction Matters",
        "we think   widget friction\nmatters today",
      ),
    ).toBe(true);
    expect(evidenceQuoteInSource("short", "short")).toBe(false);
    expect(
      evidenceQuoteInSource("invented claim xyz", "real conversation"),
    ).toBe(false);
  });

  it("rejects claims that overstate the quote", () => {
    expect(
      claimEntailedByQuote({
        title: "Amber filters",
        body: "Testing with amber filters.",
        quote: "Status → testing with amber filters.",
      }),
    ).toBe(true);
    expect(
      claimEntailedByQuote({
        title: "Quantum tunneling explains logits",
        body: "Quantum tunneling fully validates our production model worldwide.",
        quote: "Quantum tunneling explains the logit spike we saw",
      }),
    ).toBe(false);
  });

  it("round-trips evidence tags", () => {
    const tag = evidenceTag("verbatim span from chat");
    expect(extractEvidenceQuote([tag, "other"])).toBe(
      "verbatim span from chat",
    );
    expect(stripEvidenceTags([tag, "other"])).toEqual(["other"]);
  });
});
