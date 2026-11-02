import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { getAppDataDir } from "@/lib/server/paths";

import { FakeEmbedder } from "./fake-embedder";
import type { Embedder, EmbedderStatus, EmbeddingModelId } from "./types";
import {
  DEFAULT_EMBEDDING_MODEL,
  FALLBACK_EMBEDDING_MODEL,
  LIGHT_EMBEDDING_MODEL,
  QUERY_INSTRUCTION,
  QWEN3_REVISION,
} from "./types";

export type { Embedder, EmbedderStatus, EmbeddingModelId };

let singleton: Embedder | null = null;
let status: EmbedderStatus = { state: "idle" };
const listeners = new Set<(s: EmbedderStatus) => void>();

export function getEmbedderStatus(): EmbedderStatus {
  return status;
}

export function onEmbedderStatus(fn: (s: EmbedderStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function setStatus(next: EmbedderStatus) {
  status = next;
  for (const fn of listeners) fn(next);
}

export function modelsDir(): string {
  const dir = path.join(getAppDataDir(), "models");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveEmbeddingModelId(
  setting?: string | null,
): EmbeddingModelId {
  if (setting === LIGHT_EMBEDDING_MODEL) return LIGHT_EMBEDDING_MODEL;
  if (setting === FALLBACK_EMBEDDING_MODEL) return FALLBACK_EMBEDDING_MODEL;
  if (setting === "fake") return "fake";
  return DEFAULT_EMBEDDING_MODEL;
}

/**
 * Returns the process embedder. Uses FakeEmbedder when
 * ARAITCHI_FAKE_EMBEDDINGS=1 (tests/CI) or model is "fake".
 */
export async function getEmbedder(
  modelSetting?: string | null,
): Promise<Embedder> {
  const modelId = resolveEmbeddingModelId(modelSetting);
  // Tests may inject a custom embedder via setEmbedderForTests.
  if (
    singleton &&
    (process.env.VITEST || process.env.ARAITCHI_FAKE_EMBEDDINGS === "1")
  ) {
    return singleton;
  }
  if (
    process.env.ARAITCHI_FAKE_EMBEDDINGS === "1" ||
    process.env.VITEST ||
    modelId === "fake"
  ) {
    singleton = new FakeEmbedder();
    setStatus(singleton.getStatus());
    return singleton;
  }

  if (singleton && singleton.modelId === modelId) return singleton;

  const workerEmbedder = await createWorkerEmbedder(modelId);
  singleton = workerEmbedder;
  return workerEmbedder;
}

/** Test helper: force a specific embedder instance. */
export function setEmbedderForTests(embedder: Embedder | null) {
  singleton = embedder;
  setStatus(embedder?.getStatus() ?? { state: "idle" });
}

class WorkerEmbedder implements Embedder {
  readonly modelId: EmbeddingModelId;
  dims = 1024;
  private worker: Worker | null = null;
  private queue: {
    texts: string[];
    isQuery: boolean;
    resolve: (v: Float32Array[]) => void;
    reject: (e: Error) => void;
  }[] = [];
  private busy = false;
  private ready = false;

  constructor(modelId: EmbeddingModelId) {
    this.modelId = modelId;
  }

  async init() {
    setStatus({ state: "downloading", model: this.modelId, progress: 0 });
    const workerPath = path.join(
      process.cwd(),
      "src/lib/server/memory/embedder-worker.mjs",
    );
    this.worker = new Worker(workerPath, {
      workerData: {
        modelId: this.modelId,
        cacheDir: modelsDir(),
        revision:
          this.modelId === DEFAULT_EMBEDDING_MODEL ? QWEN3_REVISION : undefined,
        dtype: this.modelId === DEFAULT_EMBEDDING_MODEL ? "q8" : "fp32",
      },
    });
    await new Promise<void>((resolve, reject) => {
      this.worker!.on(
        "message",
        (msg: {
          type: string;
          progress?: number;
          dims?: number;
          error?: string;
        }) => {
          if (msg.type === "progress") {
            setStatus({
              state: "downloading",
              model: this.modelId,
              progress: msg.progress ?? 0,
            });
          } else if (msg.type === "ready") {
            this.dims = msg.dims ?? 1024;
            this.ready = true;
            setStatus({
              state: "ready",
              model: this.modelId,
              dims: this.dims,
            });
            resolve();
          } else if (msg.type === "error") {
            setStatus({
              state: "unavailable",
              reason: msg.error ?? "Embedder failed",
            });
            reject(new Error(msg.error ?? "Embedder failed"));
          } else if (msg.type === "result") {
            // handled in drain
          }
        },
      );
      this.worker!.on("error", (err) => {
        setStatus({ state: "unavailable", reason: err.message });
        reject(err);
      });
    });
  }

  getStatus(): EmbedderStatus {
    return status;
  }

  async embed(
    texts: string[],
    opts?: { isQuery?: boolean },
  ): Promise<Float32Array[]> {
    if (!this.ready || !this.worker) {
      throw new Error("Embedder not ready");
    }
    const prepared = opts?.isQuery
      ? texts.map((t) => `Instruct: ${QUERY_INSTRUCTION}\nQuery:${t}`)
      : texts;
    return new Promise((resolve, reject) => {
      this.queue.push({
        texts: prepared,
        isQuery: Boolean(opts?.isQuery),
        resolve,
        reject,
      });
      void this.drain();
    });
  }

  private async drain() {
    if (this.busy || !this.worker) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    const onMsg = (msg: {
      type: string;
      vectors?: number[][];
      error?: string;
    }) => {
      if (msg.type !== "result" && msg.type !== "error") return;
      this.worker?.off("message", onMsg);
      this.busy = false;
      if (msg.type === "error") {
        job.reject(new Error(msg.error ?? "embed failed"));
      } else {
        job.resolve((msg.vectors ?? []).map((row) => Float32Array.from(row)));
      }
      void this.drain();
    };
    this.worker.on("message", onMsg);
    this.worker.postMessage({ type: "embed", texts: job.texts });
  }
}

async function createWorkerEmbedder(
  modelId: EmbeddingModelId,
): Promise<Embedder> {
  const primary = new WorkerEmbedder(modelId);
  try {
    await primary.init();
    return primary;
  } catch (e) {
    if (modelId === DEFAULT_EMBEDDING_MODEL) {
      const fallback = new WorkerEmbedder(FALLBACK_EMBEDDING_MODEL);
      try {
        await fallback.init();
        return fallback;
      } catch {
        setStatus({
          state: "unavailable",
          reason: e instanceof Error ? e.message : "Model download failed",
        });
        return new FakeEmbedder();
      }
    }
    setStatus({
      state: "unavailable",
      reason: e instanceof Error ? e.message : "Model download failed",
    });
    return new FakeEmbedder();
  }
}
