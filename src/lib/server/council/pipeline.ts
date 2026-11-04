import "server-only";

import {
  generateText,
  stepCountIs,
  streamText,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
} from "ai";

import { labFromModelId } from "@/lib/server/models-utils";
import type { ModelDto } from "@/lib/server/models";
import { createOpenRouterClient } from "@/lib/server/openrouter";
import { loadPrompt } from "@/lib/server/prompts/load";
import type { ToolBroker } from "@/lib/server/tools/broker";

import { ANALYSIS_REPAIR_PROMPT, parseCouncilAnalysis } from "./analysis";
import {
  anonymizeMembers,
  deanonymizeAnalysis,
  formatAnonymizedPrompt,
} from "./anonymize";
import { estimateCouncilCost } from "./estimate";
import { pickSubstituteModel, type CatalogModel } from "./presets";
import {
  councilHasEnoughMembers,
  type CouncilAnalysis,
  type CouncilConfig,
  type CouncilMemberResult,
  type CouncilSummary,
  type MemberStreamEvent,
  type SynthesisStreamEvent,
} from "./types";

export type CouncilPipelineHooks = {
  onMember?: (event: MemberStreamEvent) => void;
  onSynthesis?: (event: SynthesisStreamEvent) => void;
};

function toCatalog(models: ModelDto[]): CatalogModel[] {
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    lab: m.lab,
    contextLength: m.contextLength,
    priceInPerMtok: m.priceInPerMtok,
    priceOutPerMtok: m.priceOutPerMtok,
    supportsReasoning: m.supportsReasoning,
    modalities: m.modalities,
  }));
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms`)),
      ms,
    );
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

async function runOneMember(input: {
  apiKey: string;
  modelId: string;
  system: string;
  messages: ModelMessage[];
  maxTokens: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  onDelta?: (text: string) => void;
  tools?: ToolSet;
  maxSteps?: number;
}): Promise<CouncilMemberResult> {
  const started = Date.now();
  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });

  const run = async (): Promise<CouncilMemberResult> => {
    const hasTools = input.tools && Object.keys(input.tools).length > 0;
    const result = streamText({
      model,
      system: input.system,
      messages: input.messages,
      maxOutputTokens: input.maxTokens,
      abortSignal: input.abortSignal,
      ...(hasTools
        ? {
            tools: input.tools,
            stopWhen: stepCountIs(input.maxSteps ?? 8),
          }
        : {}),
    });

    let content = "";
    for await (const delta of result.textStream) {
      content += delta;
      input.onDelta?.(delta);
    }

    const usage = await result.usage;
    const providerMeta = await result.providerMetadata;
    const cost =
      (providerMeta?.openrouter as { usage?: { cost?: number } } | undefined)
        ?.usage?.cost ?? null;

    return {
      modelId: input.modelId,
      content,
      status: "done",
      usage: {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      },
      cost,
      latencyMs: Date.now() - started,
      lab: labFromModelId(input.modelId),
    };
  };

  try {
    return await withTimeout(run(), input.timeoutMs, input.abortSignal);
  } catch (e) {
    return {
      modelId: input.modelId,
      content: "",
      status: "failed",
      usage: null,
      cost: null,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : "Member failed",
      lab: labFromModelId(input.modelId),
    };
  }
}

async function runMemberWithRetry(input: {
  apiKey: string;
  modelId: string;
  system: string;
  messages: ModelMessage[];
  maxTokens: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  catalog: CatalogModel[];
  councilIds: string[];
  hooks?: CouncilPipelineHooks;
  tools?: ToolSet;
  maxSteps?: number;
}): Promise<CouncilMemberResult> {
  const { hooks } = input;
  hooks?.onMember?.({
    phase: "start",
    modelId: input.modelId,
    lab: labFromModelId(input.modelId),
  });

  const attempt = (modelId: string, substitutedFrom?: string) =>
    runOneMember({
      apiKey: input.apiKey,
      modelId,
      system: input.system,
      messages: input.messages,
      maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      tools: input.tools,
      maxSteps: input.maxSteps,
      onDelta: (text) =>
        hooks?.onMember?.({
          phase: "delta",
          modelId,
          text,
          substitutedFrom,
        }),
    });

  let result = await attempt(input.modelId);
  if (result.status === "failed" && !input.abortSignal?.aborted) {
    result = await attempt(input.modelId);
  }

  if (result.status === "failed" && !input.abortSignal?.aborted) {
    const sub = pickSubstituteModel(
      input.catalog,
      input.councilIds,
      input.modelId,
    );
    if (sub) {
      hooks?.onMember?.({
        phase: "substituted",
        modelId: sub.id,
        lab: sub.lab,
        substitutedFrom: input.modelId,
      });
      const subResult = await attempt(sub.id, input.modelId);
      if (subResult.status === "done") {
        const out: CouncilMemberResult = {
          ...subResult,
          status: "substituted",
          substitutedFrom: input.modelId,
        };
        hooks?.onMember?.({
          phase: "finish",
          modelId: out.modelId,
          lab: out.lab,
          content: out.content,
          usage: out.usage,
          cost: out.cost,
          latencyMs: out.latencyMs,
          substitutedFrom: input.modelId,
        });
        return out;
      }
    }
    hooks?.onMember?.({
      phase: "error",
      modelId: input.modelId,
      error: result.error,
      latencyMs: result.latencyMs,
    });
    return result;
  }

  hooks?.onMember?.({
    phase: "finish",
    modelId: result.modelId,
    lab: result.lab,
    content: result.content,
    usage: result.usage,
    cost: result.cost,
    latencyMs: result.latencyMs,
  });
  return result;
}

async function runSynthesizer(input: {
  apiKey: string;
  modelId: string;
  system: string;
  userPrompt: string;
  supportsStructured: boolean;
  abortSignal?: AbortSignal;
  hooks?: CouncilPipelineHooks;
}): Promise<{
  analysis: CouncilAnalysis;
  cost: number;
  usage: CouncilMemberResult["usage"];
  raw: string;
}> {
  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });

  const call = async (extra?: string) => {
    const result = await generateText({
      model,
      system: input.system,
      prompt: extra ? `${input.userPrompt}\n\n${extra}` : input.userPrompt,
      maxOutputTokens: 2048,
      abortSignal: input.abortSignal,
      ...(input.supportsStructured
        ? {
            providerOptions: {
              openrouter: {
                response_format: { type: "json_object" },
              },
            },
          }
        : {}),
    });
    const providerMeta = await result.providerMetadata;
    const cost =
      (providerMeta?.openrouter as { usage?: { cost?: number } } | undefined)
        ?.usage?.cost ?? 0;
    return {
      text: result.text,
      cost,
      usage: {
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      },
    };
  };

  let first = await call();
  let parsed = parseCouncilAnalysis(first.text);
  if (!parsed.ok) {
    first = await call(ANALYSIS_REPAIR_PROMPT);
    parsed = parseCouncilAnalysis(first.text);
  }
  if (!parsed.ok) {
    throw new Error(`Synthesizer JSON invalid: ${parsed.error}`);
  }

  input.hooks?.onSynthesis?.({
    phase: "final",
    text: parsed.analysis.finalAnswer,
  });

  return {
    analysis: parsed.analysis,
    cost: first.cost,
    usage: first.usage,
    raw: first.text,
  };
}

export type CouncilRunResult = {
  members: CouncilMemberResult[];
  analysis:
    (CouncilAnalysis & { labelToModelId: Record<string, string> }) | null;
  summary: CouncilSummary;
  finalAnswer: string;
  error?: string;
};

export async function runCouncil(input: {
  apiKey: string;
  config: CouncilConfig;
  catalog: ModelDto[];
  projectSystem: string;
  modelMessages: ModelMessage[];
  contextChars: number;
  abortSignal?: AbortSignal;
  hooks?: CouncilPipelineHooks;
  allowOverBudget?: boolean;
  broker?: ToolBroker;
  maxSteps?: number;
  /** Project root for citation-broker cache. */
  projectPath?: string;
  /** Override synthesizer system prompt (task-specific merge modes). */
  synthesizerSystem?: string;
  /**
   * Prefill member answers (e.g. probe reuse) — those model ids skip generation.
   * Remaining council members still run normally.
   */
  prefilledMembers?: { modelId: string; content: string; cost?: number }[];
}): Promise<CouncilRunResult> {
  const started = Date.now();
  const catalog = toCatalog(input.catalog);
  const estimate = estimateCouncilCost({
    contextChars: input.contextChars,
    config: input.config,
    catalog,
  });

  if (
    estimate.totalHighUsd > input.config.budgetCapUsd &&
    !input.allowOverBudget
  ) {
    throw Object.assign(
      new Error(
        `Estimated cost up to $${estimate.totalHighUsd.toFixed(4)} exceeds budget cap $${input.config.budgetCapUsd.toFixed(2)}`,
      ),
      { code: "OVER_BUDGET", estimate },
    );
  }

  const memberSystem = [
    loadPrompt("council-member.md"),
    input.broker ? `\n${loadPrompt("tools-policy.md")}` : "",
    "",
    input.projectSystem,
  ]
    .filter(Boolean)
    .join("\n");

  const timeoutMs = input.config.memberTimeoutSec * 1000;
  const councilIds = [...input.config.members];
  const prefilled = new Map(
    (input.prefilledMembers ?? []).map((p) => [p.modelId, p]),
  );

  // Ensure prefilled probe models appear in the member list without duplicate pays.
  const memberIds = [...input.config.members];
  for (const p of input.prefilledMembers ?? []) {
    if (!memberIds.includes(p.modelId)) memberIds.push(p.modelId);
  }

  const memberPromises = memberIds.map(async (modelId) => {
    const pref = prefilled.get(modelId);
    if (pref) {
      input.hooks?.onMember?.({
        phase: "finish",
        modelId,
        lab: labFromModelId(modelId),
        content: pref.content,
        cost: pref.cost ?? 0,
        latencyMs: 0,
      });
      return {
        modelId,
        content: pref.content,
        status: "done" as const,
        usage: null,
        cost: pref.cost ?? 0,
        latencyMs: 0,
        lab: labFromModelId(modelId),
      };
    }
    // Skip tools for models the catalog says cannot call them.
    const supportsTools =
      input.catalog.find((m) => m.id === modelId)?.supportsTools ?? true;
    const tools =
      input.broker && supportsTools
        ? input.broker.getAiSdkTools({
            modelId,
            signal: input.abortSignal,
            includeNonRead: true,
          })
        : undefined;
    return runMemberWithRetry({
      apiKey: input.apiKey,
      modelId,
      system: memberSystem,
      messages: input.modelMessages,
      maxTokens: input.config.maxOutputTokensPerMember,
      timeoutMs,
      abortSignal: input.abortSignal,
      catalog,
      councilIds,
      hooks: input.hooks,
      tools,
      maxSteps: input.maxSteps,
    });
  });

  const members = await Promise.all(memberPromises);
  const ok = members.filter(
    (m) => m.status === "done" || m.status === "substituted",
  );
  const failed = members.filter((m) => m.status === "failed");

  if (!councilHasEnoughMembers(ok.length)) {
    const summary: CouncilSummary = {
      membersOk: ok.length,
      membersFailed: failed.length,
      totalCost: members.reduce((s, m) => s + (m.cost ?? 0), 0),
      totalTimeMs: Date.now() - started,
    };
    return {
      members,
      analysis: null,
      summary,
      finalAnswer: "",
      error: `Council failed: only ${ok.length} of ${members.length} members succeeded (need ≥ 2).`,
    };
  }

  const { anonymized, labelToModelId } = anonymizeMembers(
    ok.map((m) => ({ modelId: m.modelId, content: m.content })),
  );

  // T13: citation-check member answers before synthesis (via tool broker).
  let citationBrief = "";
  try {
    const { checkCitations, formatMemberCitationBrief } =
      await import("@/lib/server/citations/check");
    const briefs: string[] = [];
    for (const a of anonymized) {
      const summary = await checkCitations(a.content, {
        skipSupport: true,
        broker: input.broker,
        projectPath: input.projectPath,
        apiKey: input.apiKey,
      });
      briefs.push(formatMemberCitationBrief(a.label, summary));
    }
    if (briefs.length) {
      citationBrief = [
        "",
        "## Citation checks (pre-synthesis)",
        ...briefs,
      ].join("\n");
    }
  } catch {
    citationBrief = "";
  }

  const synthSystem =
    input.synthesizerSystem ?? loadPrompt("council-synthesizer.md");
  const userPrompt = [
    "User question / conversation context is reflected in the member answers.",
    "Synthesize the following independent answers:",
    "",
    formatAnonymizedPrompt(anonymized),
    citationBrief,
  ]
    .filter(Boolean)
    .join("\n");

  const synthModel = input.catalog.find(
    (m) => m.id === input.config.synthesizer,
  );
  let analysisMapped:
    (CouncilAnalysis & { labelToModelId: Record<string, string> }) | null =
    null;
  let synthCost = 0;
  let finalAnswer = "";

  try {
    const synth = await runSynthesizer({
      apiKey: input.apiKey,
      modelId: input.config.synthesizer,
      system: synthSystem,
      userPrompt,
      supportsStructured: synthModel?.supportsStructuredOutputs ?? false,
      abortSignal: input.abortSignal,
      hooks: input.hooks,
    });
    analysisMapped = deanonymizeAnalysis(synth.analysis, labelToModelId);
    synthCost = synth.cost;
    finalAnswer = analysisMapped.finalAnswer;
  } catch (e) {
    return {
      members,
      analysis: null,
      summary: {
        membersOk: ok.length,
        membersFailed: failed.length,
        totalCost: members.reduce((s, m) => s + (m.cost ?? 0), 0) + synthCost,
        totalTimeMs: Date.now() - started,
      },
      finalAnswer: ok
        .map((m) => `### ${m.modelId}\n\n${m.content}`)
        .join("\n\n"),
      error: e instanceof Error ? e.message : "Synthesizer failed",
    };
  }

  const summary: CouncilSummary = {
    membersOk: ok.length,
    membersFailed: failed.length,
    totalCost: members.reduce((s, m) => s + (m.cost ?? 0), 0) + synthCost,
    totalTimeMs: Date.now() - started,
    confidence: analysisMapped?.confidence,
  };

  return {
    members,
    analysis: analysisMapped,
    summary,
    finalAnswer,
  };
}

/** Build context char count for estimates (system + messages). */
export function countContextChars(
  system: string,
  messages: UIMessage[] | ModelMessage[],
): number {
  let n = system.length;
  for (const m of messages) {
    if ("content" in m && typeof m.content === "string") {
      n += m.content.length;
    } else if ("parts" in m && Array.isArray(m.parts)) {
      for (const p of m.parts as { text?: string }[]) {
        if (typeof p.text === "string") n += p.text.length;
      }
    } else if ("content" in m && Array.isArray(m.content)) {
      for (const p of m.content as { text?: string }[]) {
        if (typeof p.text === "string") n += p.text.length;
      }
    }
  }
  return n;
}
