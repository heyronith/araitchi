import { describe, expect, it } from "vitest";

import {
  anonymisedCorrectionsJsonl,
  exportAnonymisedCorrections,
} from "@/lib/server/gate/corrections-export";

describe("corrections export", () => {
  it("returns anonymised lines without raw text", () => {
    const lines = exportAnonymisedCorrections();
    for (const line of lines) {
      expect(line.textHash).toMatch(/^[a-f0-9]{64}$/);
      expect(line).not.toHaveProperty("text");
      expect(line.action).toBeTruthy();
    }
  });

  it("serialises JSONL", () => {
    const jsonl = anonymisedCorrectionsJsonl();
    if (jsonl) {
      const first = jsonl.split("\n").filter(Boolean)[0];
      const parsed = JSON.parse(first!) as { textHash: string };
      expect(parsed.textHash).toHaveLength(64);
    }
  });
});
