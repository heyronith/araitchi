import "server-only";

import { createHash } from "node:crypto";

import type { ChatMode } from "@/lib/server/council/types";
import { getEmbedder } from "@/lib/server/memory/embedder";

import { listProjectCorrections } from "./corrections";
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

/** Research-critical keyword safety (never down-route to solo/probe). */
export function researchCriticalHint(text: string): boolean {
  return /hypothesis|hypotheses|experiment|protocol|literature|survey|novelty|papers?\b|critique|weakness|flaw|results?\b|interpret/i.test(
    text,
  );
}

function withResearchSafety(
  text: string,
  taskType: TaskType,
  action: GateAction,
  alwaysCouncil: TaskType[],
): { taskType: TaskType; action: GateAction; reasonSuffix: string } {
  let next = action;
  if (alwaysCouncil.includes(taskType)) next = "council";
  if (
    researchCriticalHint(text) &&
    next !== "council" &&
    next !== "retrieve_evidence"
  ) {
    return {
      taskType,
      action: "council",
      reasonSuffix: " (research-critical safety → council)",
    };
  }
  return { taskType, action: next, reasonSuffix: "" };
}

/**
 * Quality-first classifier: rules → LLM → kNN fallback
 * (LLM error, timeout > 4s, or no credits/offline).
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
  if (rule && (rule.layer === "forced" || rule.layer === "rule")) {
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

  const runKnn = async (reasonPrefix: string): Promise<Classification> => {
    const embedder = await getEmbedder();
    const knn = await classifyKnn({
      text,
      embedder,
      examples: seeds,
      k: settings.knnK,
    });
    let action = actionForTaskType(knn.taskType);
    if (settings.alwaysCouncil.includes(knn.taskType)) action = "council";
    if (!settings.probeEnabled && action === "probe") action = "council";
    const safe = withResearchSafety(
      text,
      knn.taskType,
      action,
      settings.alwaysCouncil,
    );
    return {
      taskType: safe.taskType,
      stakes: knn.stakes,
      needsEvidence: knn.needsEvidence || researchCriticalHint(text),
      action: safe.action,
      layer: "knn",
      confidence: knn.confidence,
      reason: `${reasonPrefix}${knn.reason}${safe.reasonSuffix}`,
      inputHash,
      cleanedText: text,
      costUsd: null,
      latencyMs: Date.now() - started,
    };
  };

  if (!input.apiKey) {
    return runKnn("LLM skipped (no API key); ");
  }

  const timeout = AbortSignal.timeout(4000);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeout])
    : timeout;

  try {
    const llm = await classifyWithLlm({
      apiKey: input.apiKey,
      modelId: settings.classifierModel,
      text,
      signal,
    });
    if (llm.reason.startsWith("LLM classify failed")) {
      return runKnn(`LLM parse failed; kNN fallback. `);
    }
    let action = actionForTaskType(llm.taskType);
    if (settings.alwaysCouncil.includes(llm.taskType)) action = "council";
    if (!settings.probeEnabled && action === "probe") {
      action = "council";
    }
    const safe = withResearchSafety(
      text,
      llm.taskType,
      action,
      settings.alwaysCouncil,
    );
    const disabledNote =
      !settings.probeEnabled && actionForTaskType(llm.taskType) === "probe"
        ? " (probe disabled → council)"
        : "";
    return {
      taskType: safe.taskType,
      stakes: llm.stakes,
      needsEvidence: llm.needsEvidence,
      action: safe.action,
      layer: "llm",
      confidence: 0.9,
      reason: `${llm.reason}${safe.reasonSuffix}${disabledNote}`,
      inputHash,
      cleanedText: text,
      costUsd: llm.costUsd,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const timedOut = /abort|timeout/i.test(msg);
    return runKnn(
      timedOut
        ? `LLM timed out (>4s); kNN fallback. `
        : `LLM failed (${msg}); kNN fallback. `,
    );
  }
}
