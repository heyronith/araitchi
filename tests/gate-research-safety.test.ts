import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/memory/embedder", async () => {
  const { FakeEmbedder } = await import("@/lib/server/memory/fake-embedder");
  return {
    getEmbedder: async () => new FakeEmbedder(),
    shutdownEmbedder: async () => {},
  };
});

import { classifyRequest } from "@/lib/server/gate/classify";
import { clearKnnCache } from "@/lib/server/gate/knn";
import { ensureResearchStructure } from "@/lib/server/project/init";

describe("research-critical safety", () => {
  beforeEach(() => clearKnnCache());

  it("routes low-confidence researchy text to council without API key", async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), "araitchi-gate-safe-"));
    ensureResearchStructure(projectPath);
    const r = await classifyRequest({
      projectPath,
      text: "Propose 3 rival hypotheses for why dropout works",
      mode: "auto",
      apiKey: null,
      seeds: [
        {
          id: "s1",
          text: "hello there friend",
          taskType: "chat",
          stakes: "low",
          needsEvidence: false,
        },
      ],
    });
    expect(r.action).toBe("council");
  });
});
