import "server-only";

import {
  getCouncilConfig,
  getProjectSetting,
  setProjectSetting,
} from "@/lib/server/project/settings";

import {
  DEFAULT_EMBEDDING_MODEL,
  LIGHT_EMBEDDING_MODEL,
  type EmbeddingModelId,
} from "./types";

export type MemorySettings = {
  embeddingModel: EmbeddingModelId | "fake";
  scribeEnabled: boolean;
  scribeRequireReview: boolean;
  /** null → use council synthesizer */
  scribeModel: string | null;
  memoryTokens: number;
  lastScribeCostUsd: number | null;
};

const DEFAULTS: MemorySettings = {
  embeddingModel: DEFAULT_EMBEDDING_MODEL,
  scribeEnabled: true,
  scribeRequireReview: false,
  scribeModel: null,
  memoryTokens: 6000,
  lastScribeCostUsd: null,
};

export function getMemorySettings(projectPath: string): MemorySettings {
  const embeddingModel = getProjectSetting<string>(
    projectPath,
    "memory.embeddingModel",
    DEFAULT_EMBEDDING_MODEL,
  );
  const scribeEnabled = getProjectSetting<boolean>(
    projectPath,
    "scribe.enabled",
    true,
  );
  const scribeRequireReview = getProjectSetting<boolean>(
    projectPath,
    "scribe.requireReview",
    false,
  );
  const scribeModel = getProjectSetting<string | null>(
    projectPath,
    "scribe.model",
    null,
  );
  const memoryTokens = getProjectSetting<number>(
    projectPath,
    "context.memoryTokens",
    6000,
  );
  const lastScribeCostUsd = getProjectSetting<number | null>(
    projectPath,
    "scribe.lastCostUsd",
    null,
  );
  return {
    embeddingModel:
      embeddingModel === LIGHT_EMBEDDING_MODEL ||
      embeddingModel === "fake" ||
      embeddingModel === DEFAULT_EMBEDDING_MODEL
        ? (embeddingModel as MemorySettings["embeddingModel"])
        : DEFAULT_EMBEDDING_MODEL,
    scribeEnabled: Boolean(scribeEnabled),
    scribeRequireReview: Boolean(scribeRequireReview),
    scribeModel: scribeModel || null,
    memoryTokens:
      typeof memoryTokens === "number" && Number.isFinite(memoryTokens)
        ? Math.max(1000, Math.min(20000, Math.floor(memoryTokens)))
        : DEFAULTS.memoryTokens,
    lastScribeCostUsd:
      typeof lastScribeCostUsd === "number" ? lastScribeCostUsd : null,
  };
}

export function setMemorySettings(
  projectPath: string,
  patch: Partial<MemorySettings>,
): MemorySettings {
  if (patch.embeddingModel != null) {
    setProjectSetting(
      projectPath,
      "memory.embeddingModel",
      patch.embeddingModel,
    );
  }
  if (typeof patch.scribeEnabled === "boolean") {
    setProjectSetting(projectPath, "scribe.enabled", patch.scribeEnabled);
  }
  if (typeof patch.scribeRequireReview === "boolean") {
    setProjectSetting(
      projectPath,
      "scribe.requireReview",
      patch.scribeRequireReview,
    );
  }
  if (patch.scribeModel !== undefined) {
    setProjectSetting(projectPath, "scribe.model", patch.scribeModel);
  }
  if (typeof patch.memoryTokens === "number") {
    setProjectSetting(projectPath, "context.memoryTokens", patch.memoryTokens);
  }
  if (patch.lastScribeCostUsd !== undefined) {
    setProjectSetting(
      projectPath,
      "scribe.lastCostUsd",
      patch.lastScribeCostUsd,
    );
  }
  return getMemorySettings(projectPath);
}

/** Resolve the OpenRouter model id the scribe should call. */
export function resolveScribeModelId(projectPath: string): string {
  const settings = getMemorySettings(projectPath);
  if (settings.scribeModel?.trim()) return settings.scribeModel.trim();
  try {
    const council = getCouncilConfig(projectPath);
    if (council.synthesizer?.trim()) return council.synthesizer.trim();
  } catch {
    // ignore
  }
  return "openai/gpt-4o-mini";
}
