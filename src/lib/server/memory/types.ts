export type EmbeddingOwnerType =
  "record" | "session_summary" | "doc_chunk" | "paper";

export type EmbeddingModelId =
  | "onnx-community/Qwen3-Embedding-0.6B-ONNX"
  | "Xenova/all-MiniLM-L6-v2"
  | "onnx-community/embeddinggemma-300m-ONNX"
  | "fake";

// Prefer config/defaults.json when available (loaded lazily by settings).
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModelId =
  "onnx-community/Qwen3-Embedding-0.6B-ONNX";

export const LIGHT_EMBEDDING_MODEL: EmbeddingModelId =
  "Xenova/all-MiniLM-L6-v2";

export const FALLBACK_EMBEDDING_MODEL: EmbeddingModelId =
  "onnx-community/embeddinggemma-300m-ONNX";

/** Pinned revision for the default Qwen3 ONNX port. */
export const QWEN3_REVISION = "main";

export const QUERY_INSTRUCTION =
  "Given a research question, retrieve relevant notes, hypotheses, papers and document passages";

export type EmbedderStatus =
  | { state: "ready"; model: EmbeddingModelId; dims: number }
  | { state: "downloading"; model: EmbeddingModelId; progress: number }
  | { state: "unavailable"; reason: string }
  | { state: "idle" };

export interface Embedder {
  readonly modelId: EmbeddingModelId;
  readonly dims: number;
  embed(texts: string[], opts?: { isQuery?: boolean }): Promise<Float32Array[]>;
  getStatus(): EmbedderStatus;
}

export type HybridHit = {
  ownerType: EmbeddingOwnerType;
  ownerId: string;
  chunkIdx: number;
  score: number;
  text: string;
  meta?: Record<string, unknown>;
};
