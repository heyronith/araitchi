import type { Embedder, EmbedderStatus, EmbeddingModelId } from "./types";
import { fakeEmbed } from "./vector";

/** Deterministic in-process embedder for unit/e2e tests (no model download). */
export class FakeEmbedder implements Embedder {
  readonly modelId: EmbeddingModelId = "fake";
  readonly dims: number;

  constructor(dims = 32) {
    this.dims = dims;
  }

  async embed(
    texts: string[],
    opts?: { isQuery?: boolean },
  ): Promise<Float32Array[]> {
    const prefix = opts?.isQuery ? "query:" : "doc:";
    return texts.map((t) => fakeEmbed(prefix + t, this.dims));
  }

  getStatus(): EmbedderStatus {
    return { state: "ready", model: this.modelId, dims: this.dims };
  }
}
