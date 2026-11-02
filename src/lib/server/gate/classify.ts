import "server-only";

import { createHash } from "node:crypto";

import { getEmbedder } from "@/lib/server/memory/embedder";
import type { ChatMode } from "@/lib/server/council/types";

import { classifyKnn, loadSeedExamples, type SeedExample } from "./knn";
import { classifyWithLlm } from "./llm-classify";
import { applyRules } from "./rules";
import { getGateSettings } from "./settings";
import {
  actionForTaskType,
  type GateAction,
  type GateLayer,
  type Stakes,
  type TaskType,
} from "./taxonomy";
import { listProjectCorrections } from "./corrections";

export type Classification = {
  taskType: TaskType;
  stakes: Stakes;
  needsEvidence: boolean;
  action: GateAction;
  layer: GateLayer;
  confidence: number;
  reason: string;
  inputHash: string;
  cleanedText: string;
  costUsd: number | null;
  latencyMs: number;
};

export function hashInput(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 24);
}

/**
 * Three-layer classifier: rules → kNN → LLM fallback.
 * When mode is solo/council, rules force that action.
 */
export async function classifyRequest(input: {
  projectPath: string;
  text: string;
  mode: ChatMode | "auto";
  apiKey?: string | null;
  signal?: AbortSignal;
  /** Inject seeds for tests. */
  seeds?: SeedExample[];
}): Promise<Classification> {
  const started = Date.now();
  const settings = getGateSettings(input.projectPath);
  const text = input.text.trim();
  const inputHash = hashInput(text);

  const rule = applyRules({ text, mode: input.mode });
  if (rule) {
    // Forced solo/council still allow slash overrides above; for forced mode
    // we keep the forced action but may refine taskType via kNN when auto…
    // Forced modes return immediately.
    if (rule.layer === "forced" || rule.layer === "rule") {
      return {
        taskType: rule.taskType,
        stakes: rule.stakes,
        needsEvidence: rule.needsEvidence,
        action: rule.action,
        layer: rule.layer,
        confidence: rule.confidence,
        reason: rule.reason,
        inputHash,
        cleanedText: rule.cleanedText ?? text,
        costUsd: null,
        latencyMs: Date.now() - started,
      };
    }
  }

  // Auto path: kNN then maybe LLM
  const corrections = listProjectCorrections(input.projectPath);
  const seeds =
    input.seeds ??
    loadSeedExamples(
      corrections.map((c) => ({
        id: `corr-${c.id}`,
        text: c.text,
        taskType: c.taskType,
        stakes: c.stakes,
        needsEvidence: c.needsEvidence,
      })),
    );

  const embedder = await getEmbedder();
  const knn = await classifyKnn({
    text,
    embedder,
    examples: seeds,
    k: settings.knnK,
  });

  // Apply project always-council list override on mapped action
  let action = actionForTaskType(knn.taskType);
  if (settings.alwaysCouncil.includes(knn.taskType)) {
    action = "council";
  }

  if (knn.confidence >= settings.knnThreshold) {
    return {
      taskType: knn.taskType,
      stakes: knn.stakes,
      needsEvidence: knn.needsEvidence,
      action,
      layer: "knn",
      confidence: knn.confidence,
      reason: knn.reason,
      inputHash,
      cleanedText: text,
      costUsd: null,
      latencyMs: Date.now() - started,
    };
  }

  // Safety until the gate target is met: never down-route research-critical
  // work to solo/probe when confidence is low and the text looks researchy.
  const researchCriticalHint =
    /hypothesis|hypotheses|experiment|protocol|literature|survey|novelty|papers?\b|critique|weakness|flaw|results?\b|interpret/i.test(
      text,
    );

  // LLM fallback
  if (!input.apiKey) {
    const safeAction =
      researchCriticalHint && action !== "council"
        ? ("council" as GateAction)
        : action;
    return {
      taskType:
        safeAction === "council" &&
        !settings.alwaysCouncil.includes(knn.taskType)
          ? ("other" as TaskType)
          : knn.taskType,
      stakes: knn.stakes,
      needsEvidence: knn.needsEvidence || researchCriticalHint,
      action: safeAction,
      layer: "knn",
      confidence: knn.confidence,
      reason:
        safeAction === "council" && action !== "council"
          ? `${knn.reason} (low-confidence research hint → council; no API key)`
          : `${knn.reason} (LLM skipped: no API key)`,
      inputHash,
      cleanedText: text,
      costUsd: null,
      latencyMs: Date.now() - started,
    };
  }

  try {
    const llm = await classifyWithLlm({
      apiKey: input.apiKey,
      modelId: settings.classifierModel,
      text,
      signal: input.signal,
    });
    let llmAction = actionForTaskType(llm.taskType);
    if (settings.alwaysCouncil.includes(llm.taskType)) {
      llmAction = "council";
    }
    // Low-confidence research safety: escalate to council rather than solo/probe
    if (
      researchCriticalHint &&
      llmAction !== "council" &&
      llmAction !== "retrieve_evidence"
    ) {
      llmAction = "council";
    }
    return {
      taskType: llm.taskType,
      stakes: llm.stakes,
      needsEvidence: llm.needsEvidence,
      action: llmAction,
      layer: "llm",
      confidence: 0.8,
      reason:
        llmAction === "council" &&
        actionForTaskType(llm.taskType) !== "council" &&
        researchCriticalHint
          ? `${llm.reason} (research-critical safety → council)`
          : llm.reason,
      inputHash,
      cleanedText: text,
      costUsd: llm.costUsd,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    // Prefer council over solo when the request looks research-critical.
    if (researchCriticalHint) {
      return {
        taskType: knn.taskType,
        stakes: knn.stakes,
        needsEvidence: true,
        action: "council",
        layer: "knn",
        confidence: knn.confidence,
        reason: `${knn.reason} (LLM failed; research-critical safety → council)`,
        inputHash,
        cleanedText: text,
        costUsd: null,
        latencyMs: Date.now() - started,
      };
    }
    const safe =
      action === "solo"
        ? {
            taskType: knn.taskType,
            stakes: knn.stakes,
            needsEvidence: knn.needsEvidence,
            action,
          }
        : {
            taskType: "other" as TaskType,
            stakes: "medium" as Stakes,
            needsEvidence: false,
            action: "solo" as GateAction,
          };
    return {
      ...safe,
      layer: "knn",
      confidence: knn.confidence,
      reason: `${knn.reason} (LLM fallback failed: ${e instanceof Error ? e.message : "error"}; stayed solo)`,
      inputHash,
      cleanedText: text,
      costUsd: null,
      latencyMs: Date.now() - started,
    };
  }
}
