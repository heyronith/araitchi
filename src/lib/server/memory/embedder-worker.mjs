/**
 * Worker thread for Transformers.js embeddings.
 * Loaded via worker_threads so model I/O never blocks the Next.js event loop.
 */
import { parentPort, workerData } from "node:worker_threads";
import { env, pipeline } from "@huggingface/transformers";

const { modelId, cacheDir, revision, dtype } = workerData;

env.cacheDir = cacheDir;
env.allowLocalModels = true;

let extractor = null;

async function init() {
  try {
    extractor = await pipeline("feature-extraction", modelId, {
      dtype: dtype || "q8",
      revision: revision || undefined,
      progress_callback: (p) => {
        if (p?.status === "progress" && typeof p.progress === "number") {
          parentPort?.postMessage({
            type: "progress",
            progress: Math.min(100, Math.max(0, p.progress)),
          });
        }
      },
    });
    // Probe dims
    const probe = await extractor("ping", {
      pooling: modelId.includes("Qwen3") ? "last_token" : "mean",
      normalize: true,
    });
    const dims = probe?.data?.length ?? probe?.dims?.at(-1) ?? 384;
    parentPort?.postMessage({ type: "ready", dims });
  } catch (e) {
    parentPort?.postMessage({
      type: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

parentPort?.on("message", async (msg) => {
  if (msg?.type !== "embed" || !extractor) return;
  try {
    const pooling = modelId.includes("Qwen3") ? "last_token" : "mean";
    const out = await extractor(msg.texts, { pooling, normalize: true });
    // out may be Tensor with dims [batch, hidden]
    let vectors = [];
    if (out?.tolist) {
      const list = out.tolist();
      vectors = Array.isArray(list[0]) ? list : [list];
    } else if (out?.data) {
      const data = Array.from(out.data);
      const dims = out.dims?.at(-1) ?? data.length;
      for (let i = 0; i < data.length; i += dims) {
        vectors.push(data.slice(i, i + dims));
      }
    }
    parentPort?.postMessage({ type: "result", vectors });
  } catch (e) {
    parentPort?.postMessage({
      type: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

void init();
