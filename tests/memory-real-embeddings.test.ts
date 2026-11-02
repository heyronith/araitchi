import { describe, expect, it } from "vitest";

import { getEmbedder, setEmbedderForTests } from "@/lib/server/memory/embedder";
import { cosine } from "@/lib/server/memory/vector";

const enabled = process.env.ARAITCHI_REAL_EMBEDDINGS === "1";

describe.skipIf(!enabled)("real embeddings (optional)", () => {
  it("loads the configured ONNX model and embeds two texts", async () => {
    setEmbedderForTests(null);
    delete process.env.ARAITCHI_FAKE_EMBEDDINGS;
    // Force past the VITEST fake short-circuit for this one test.
    const prevVitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const embedder = await getEmbedder(
        process.env.ARAITCHI_EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2",
      );
      expect(embedder.dims).toBeGreaterThan(8);
      const [a, b] = await embedder.embed(
        ["caffeine half-life in adults", "unrelated astronomy facts"],
        { isQuery: false },
      );
      expect(a!.length).toBe(embedder.dims);
      expect(cosine(a!, a!)).toBeCloseTo(1, 3);
      expect(cosine(a!, b!)).toBeLessThan(0.95);
    } finally {
      if (prevVitest != null) process.env.VITEST = prevVitest;
      setEmbedderForTests(null);
      process.env.ARAITCHI_FAKE_EMBEDDINGS = "1";
    }
  }, 180_000);
});
