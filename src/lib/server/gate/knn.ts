import { readFileSync } from "node:fs";
import path from "node:path";

import type { Embedder } from "@/lib/server/memory/types";
import { cosine } from "@/lib/server/memory/vector";

import type { Stakes, TaskType } from "./taxonomy";
import { isTaskType } from "./taxonomy";

export type SeedExample = {
  id: string;
  text: string;
  taskType: TaskType;
  stakes: Stakes;
  needsEvidence: boolean;
};

export type KnnResult = {
  taskType: TaskType;
  stakes: Stakes;
  needsEvidence: boolean;
  confidence: number;
  reason: string;
  neighbors: { id: string; taskType: TaskType; score: number }[];
};

type EmbeddedSeed = SeedExample & { vector: Float32Array };

let cached: { key: string; seeds: EmbeddedSeed[] } | null = null;

export function loadSeedExamples(
  extra: SeedExample[] = [],
  seedPath?: string,
): SeedExample[] {
  const file =
    seedPath ??
    path.join(process.cwd(), "src/lib/server/gate/seed-examples.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as SeedExample[];
  return [...raw, ...extra].filter((s) => isTaskType(s.taskType));
}

/** Embed seeds once per embedder model (tests inject FakeEmbedder). */
export async function ensureEmbeddedSeeds(
  embedder: Embedder,
  examples: SeedExample[],
): Promise<EmbeddedSeed[]> {
  const key = `${embedder.modelId}:${examples.length}:${examples.at(-1)?.id ?? ""}`;
  if (cached?.key === key) return cached.seeds;
  const vectors = await embedder.embed(
    examples.map((e) => e.text),
    { isQuery: false },
  );
  const seeds = examples.map((e, i) => ({
    ...e,
    vector: vectors[i]!,
  }));
  cached = { key, seeds };
  return seeds;
}

/** Test helper. */
export function clearKnnCache() {
  cached = null;
}

/**
 * Weighted kNN over seed embeddings.
 * Confidence = (weight of majority label) / (sum of neighbor weights).
 */
export async function classifyKnn(input: {
  text: string;
  embedder: Embedder;
  examples: SeedExample[];
  k?: number;
}): Promise<KnnResult> {
  const k = input.k ?? 7;
  const seeds = await ensureEmbeddedSeeds(input.embedder, input.examples);
  const [q] = await input.embedder.embed([input.text], { isQuery: true });
  const scored = seeds
    .map((s) => ({
      id: s.id,
      taskType: s.taskType,
      stakes: s.stakes,
      needsEvidence: s.needsEvidence,
      score: cosine(q!, s.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const weights = new Map<TaskType, number>();
  const stakesVotes = new Map<Stakes, number>();
  let needsW = 0;
  let totalW = 0;
  for (const n of scored) {
    const w = Math.max(0, n.score);
    weights.set(n.taskType, (weights.get(n.taskType) ?? 0) + w);
    stakesVotes.set(n.stakes, (stakesVotes.get(n.stakes) ?? 0) + w);
    if (n.needsEvidence) needsW += w;
    totalW += w;
  }

  let bestType: TaskType = "other";
  let bestW = -1;
  for (const [t, w] of weights) {
    if (w > bestW) {
      bestW = w;
      bestType = t;
    }
  }
  let bestStakes: Stakes = "medium";
  let bestSW = -1;
  for (const [s, w] of stakesVotes) {
    if (w > bestSW) {
      bestSW = w;
      bestStakes = s;
    }
  }

  const confidence = totalW > 0 ? bestW / totalW : 0;
  return {
    taskType: bestType,
    stakes: bestStakes,
    needsEvidence: totalW > 0 ? needsW / totalW >= 0.5 : false,
    confidence,
    reason: `kNN top-${k}: majority ${bestType} (conf ${confidence.toFixed(2)})`,
    neighbors: scored.map((n) => ({
      id: n.id,
      taskType: n.taskType,
      score: n.score,
    })),
  };
}
