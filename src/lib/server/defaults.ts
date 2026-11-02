import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type AppDefaults = {
  version: number;
  notes?: string;
  scribeModel: string;
  classifierModel: string;
  strongestSoloModel: string;
  probeModels: [string, string];
  council: {
    balancedLabs: string[];
    budgetLabs: string[];
    memberCountBalanced: number;
    memberCountBudget: number;
  };
  embeddingModel: string;
  embeddingModelLight: string;
  bench: {
    budgetCapUsd: number;
    repeats: number;
    rediscoverySimilarityThreshold: number;
  };
};

const FALLBACK: AppDefaults = {
  version: 1,
  scribeModel: "~openai/gpt-oss-latest",
  classifierModel: "~openai/gpt-oss-latest",
  strongestSoloModel: "~anthropic/claude-opus-latest",
  probeModels: [
    "~anthropic/claude-haiku-latest",
    "~google/gemini-flash-latest",
  ],
  council: {
    balancedLabs: ["anthropic", "openai", "google", "meta-llama"],
    budgetLabs: ["google", "meta-llama", "qwen", "deepseek"],
    memberCountBalanced: 3,
    memberCountBudget: 3,
  },
  embeddingModel: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
  embeddingModelLight: "Xenova/all-MiniLM-L6-v2",
  bench: {
    budgetCapUsd: 0.5,
    repeats: 3,
    rediscoverySimilarityThreshold: 0.72,
  },
};

let cached: AppDefaults | null = null;

export function defaultsPath(): string {
  return path.join(process.cwd(), "config", "defaults.json");
}

export function loadDefaults(force = false): AppDefaults {
  if (cached && !force) return cached;
  const file = defaultsPath();
  if (!existsSync(file)) {
    cached = FALLBACK;
    return cached;
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AppDefaults>;
    const probe =
      Array.isArray(raw.probeModels) && raw.probeModels.length >= 2
        ? ([String(raw.probeModels[0]), String(raw.probeModels[1])] as [
            string,
            string,
          ])
        : FALLBACK.probeModels;
    cached = {
      ...FALLBACK,
      ...raw,
      probeModels: probe,
      council: { ...FALLBACK.council, ...(raw.council ?? {}) },
      bench: { ...FALLBACK.bench, ...(raw.bench ?? {}) },
    };
    return cached;
  } catch {
    cached = FALLBACK;
    return cached;
  }
}

/** Test helper. */
export function resetDefaultsCache() {
  cached = null;
}
