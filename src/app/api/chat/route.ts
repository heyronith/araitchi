import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { nanoid } from "nanoid";

import { chatRequestSchema } from "@/lib/chat/validation";
import { estimateCouncilCost } from "@/lib/server/council/estimate";
import {
  resolveBalancedPreset,
  resolveBudgetPreset,
} from "@/lib/server/council/presets";
import { sanitizeCouncilHistoryForModel } from "@/lib/server/council/history";
import { countContextChars, runCouncil } from "@/lib/server/council/pipeline";
import {
  createBrokerForRequest,
  type BrokerToolEvent,
} from "@/lib/server/tools/broker";
import { buildBrokerTools } from "@/lib/server/tools/register";
import {
  getMaxSteps,
  getToolToggles,
  setToolToggles,
} from "@/lib/server/tools/tools-settings";
import { loadPrompt } from "@/lib/server/prompts/load";
import type { ToolToggles } from "@/lib/server/tools/types";
import {
  ensureChat,
  insertMessage,
  listMessages,
  persistSessionTranscript,
  updateMessage,
} from "@/lib/server/chats";
import { getDefaultModelId, listModels } from "@/lib/server/models";
import {
  createOpenRouterClient,
  requireOpenRouterApiKey,
} from "@/lib/server/openrouter";
import { buildProjectSystemContext } from "@/lib/server/project/context";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import {
  getCouncilConfig,
  setCouncilConfig,
} from "@/lib/server/project/settings";
import { assertLocalOrigin } from "@/lib/server/security";
import { runScribe } from "@/lib/server/memory/scribe";
import type { ScribeOutput } from "@/lib/server/memory/scribe-schema";
import { resolveGate } from "@/lib/server/gate/resolve";
import {
  insertGateDecision,
  updateGateDecision,
} from "@/lib/server/gate/decisions";
import { runProbe } from "@/lib/server/gate/probe";
import { synthesizerPromptForTask } from "@/lib/server/gate/merge";
import type { Classification } from "@/lib/server/gate/classify";
import type { GateAction } from "@/lib/server/gate/taxonomy";
import { ACTION_LABELS, TASK_TYPE_LABELS } from "@/lib/server/gate/taxonomy";

export const runtime = "nodejs";

/** UI part for one finished tool call (streamed live and persisted). */
function toolEventPart(event: BrokerToolEvent) {
  return { type: "data-tool-call" as const, id: event.id, data: event };
}

function friendlyError(status: number, message?: string) {
  if (status === 401) return "Invalid OpenRouter API key.";
  if (status === 402) return "OpenRouter account has no credits remaining.";
  if (status === 429) return "Rate limited by OpenRouter. Try again shortly.";
  if (status === 404) return "Model unavailable on OpenRouter.";
  return message || "OpenRouter request failed.";
}

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const apiKey = await requireOpenRouterApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "OpenRouter API key not configured" },
      { status: 401 },
    );
  }

  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;
  const mode = parsed.data.mode ?? "auto";
  const { chatId, messages: uiMessages, allowOverBudget } = parsed.data;
  if (parsed.data.tools) {
    setToolToggles(projectPath, parsed.data.tools);
  }
  const toggles: ToolToggles = {
    ...getToolToggles(projectPath),
    ...parsed.data.tools,
  };
  ensureChat(chatId);

  const lastUser = [...uiMessages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return Response.json({ error: "No user message" }, { status: 400 });
  }

  const existing = listMessages(chatId);
  const alreadyStored = existing.some((m) => m.id === lastUser.id);

  if (!alreadyStored) {
    const userParts =
      lastUser.parts.length > 0
        ? lastUser.parts
        : [{ type: "text", text: lastUser.content ?? "" }];

    const lastUserIdx = uiMessages.findIndex((m) => m.id === lastUser.id);
    const prior = uiMessages
      .slice(0, lastUserIdx)
      .filter((m) => m.role !== "system");
    const parentId = prior.at(-1)?.id ?? parsed.data.parentId ?? null;

    insertMessage({
      id: lastUser.id,
      chatId,
      parentId,
      role: "user",
      parts: userParts,
    });
  }

  const assistantId = nanoid();
  const lastUserText =
    typeof lastUser.content === "string" && lastUser.content
      ? lastUser.content
      : (lastUser.parts ?? [])
          .map((p) =>
            p && typeof p === "object" && "text" in p
              ? String((p as { text?: string }).text ?? "")
              : "",
          )
          .join("\n");
  const ctx = await buildProjectSystemContext(projectPath, {
    userMessage: lastUserText,
    chatId,
  });

  let gate: Classification | null = null;
  let gateDecisionId: string | null = null;
  let effectiveMode: "solo" | "council" =
    mode === "council" ? "council" : "solo";
  let evidenceMode = false;
  let probePrefills:
    { modelId: string; content: string; cost?: number }[] | undefined;
  let escalated = false;
  let probeAgreement: number | null = null;
  let taskTypeForMerge = null as Classification["taskType"] | null;

  if (mode === "auto" || parsed.data.forceAction) {
    try {
      gate = await resolveGate({
        projectPath,
        text: lastUserText,
        mode: mode === "auto" ? "auto" : mode,
        apiKey,
        forceAction: parsed.data.forceAction as GateAction | undefined,
        signal: request.signal,
      });
      const decision = insertGateDecision({
        projectPath,
        messageId: assistantId,
        chatId,
        classification: gate,
      });
      gateDecisionId = decision.id;
      taskTypeForMerge = gate.taskType;

      if (gate.action === "council") {
        effectiveMode = "council";
      } else if (gate.action === "retrieve_evidence") {
        effectiveMode = "solo";
        evidenceMode = true;
      } else if (gate.action === "probe") {
        try {
          const probe = await runProbe({
            projectPath,
            apiKey,
            userText: gate.cleanedText || lastUserText,
            projectSystem: ctx.systemText,
            signal: request.signal,
          });
          probeAgreement = probe.agreement;
          if (probe.escalate) {
            effectiveMode = "council";
            escalated = true;
            probePrefills = probe.answers.map((a) => ({
              modelId: a.modelId,
              content: a.content,
              cost: a.costUsd ?? undefined,
            }));
            updateGateDecision(projectPath, decision.id, {
              escalated: true,
              probeAgreement: probe.agreement,
              models: probe.answers.map((a) => a.modelId),
              action: "council",
            });
          } else if (gate.needsEvidence) {
            effectiveMode = "solo";
            evidenceMode = true;
            updateGateDecision(projectPath, decision.id, {
              probeAgreement: probe.agreement,
              models: probe.answers.map((a) => a.modelId),
              action: "retrieve_evidence",
            });
          } else if (probe.winner) {
            insertMessage({
              id: assistantId,
              chatId,
              parentId: lastUser.id,
              role: "assistant",
              parts: [],
              modelId: probe.winner.modelId,
            });
            const gateChip = {
              type: "data-gate",
              id: decision.id,
              data: {
                decisionId: decision.id,
                action: "solo" as const,
                actionLabel: ACTION_LABELS.solo,
                taskType: gate.taskType,
                taskLabel: TASK_TYPE_LABELS[gate.taskType],
                stakes: gate.stakes,
                layer: gate.layer,
                confidence: gate.confidence,
                reason: gate.reason,
                probeAgreement: probe.agreement,
                escalated: false,
                costUsd: probe.winner.costUsd,
              },
            };
            updateMessage(assistantId, {
              parts: [{ type: "text", text: probe.winner.content }, gateChip],
              modelId: probe.winner.modelId,
              usage: { cost: probe.winner.costUsd ?? undefined },
            });
            updateGateDecision(projectPath, decision.id, {
              actualCostUsd: probe.winner.costUsd,
              probeAgreement: probe.agreement,
              models: probe.answers.map((a) => a.modelId),
            });
            persistSessionTranscript(chatId);
            const stream = createUIMessageStream({
              originalMessages: uiMessages as UIMessage[],
              generateId: () => assistantId,
              execute: ({ writer }) => {
                const textId = nanoid();
                writer.write({ type: "text-start", id: textId });
                writer.write({
                  type: "text-delta",
                  id: textId,
                  delta: probe.winner!.content,
                });
                writer.write({ type: "text-end", id: textId });
                writer.write(gateChip as never);
              },
            });
            return createUIMessageStreamResponse({ stream });
          }
        } catch {
          effectiveMode = "solo";
        }
      } else {
        effectiveMode = "solo";
      }
    } catch {
      effectiveMode = "solo";
      gate = null;
      gateDecisionId = null;
    }
  }

  if (effectiveMode === "council" || mode === "council") {
    return handleCouncil({
      apiKey,
      projectPath,
      chatId,
      assistantId,
      lastUserId: lastUser.id,
      lastUserText: gate?.cleanedText || lastUserText,
      uiMessages: uiMessages as UIMessage[],
      allowOverBudget: Boolean(allowOverBudget),
      abortSignal: request.signal,
      projectSystem: ctx.systemText,
      contextMeta: {
        pinnedCount: ctx.pinnedCount,
        relevantCount: ctx.relevantCount,
        totalTokens: ctx.totalTokens,
        items: ctx.items,
        vectorUsed: ctx.vectorUsed,
      },
      toggles,
      toolApprovals: parsed.data.toolApprovals,
      gate,
      gateDecisionId,
      synthesizerSystem: taskTypeForMerge
        ? synthesizerPromptForTask(taskTypeForMerge)
        : undefined,
      prefilledMembers: probePrefills,
      escalated,
      probeAgreement,
    });
  }

  const modelId =
    parsed.data.modelId || getDefaultModelId() || "openai/gpt-4o-mini";
  let soloToggles = toggles;
  let soloSystemExtra = "";
  if (evidenceMode) {
    soloToggles = {
      ...toggles,
      papers: true,
      web: true,
      memory: true,
    };
    soloSystemExtra = `\n\n${loadPrompt("evidence.md")}`;
  }
  insertMessage({
    id: assistantId,
    chatId,
    parentId: lastUser.id,
    role: "assistant",
    parts: [],
    modelId,
  });

  const openrouter = createOpenRouterClient(apiKey);
  const model = openrouter(modelId, {
    usage: { include: true },
  });

  const broker = createBrokerForRequest({
    projectPath,
    chatId,
    messageId: assistantId,
  });
  if (parsed.data.toolApprovals) {
    for (const [k, v] of Object.entries(parsed.data.toolApprovals)) {
      broker.setApproval(k, v);
    }
  }
  const toolPartsSolo: unknown[] = [];
  broker.onToolEvent((event) => toolPartsSolo.push(toolEventPart(event)));
  const built = await buildBrokerTools({
    broker,
    projectPath,
    toggles: soloToggles,
  });
  let modelSupportsTools = true;
  try {
    const known = (await listModels()).find((m) => m.id === modelId);
    if (known) modelSupportsTools = known.supportsTools;
  } catch {
    // catalog unavailable: assume tool support
  }
  const aiTools = modelSupportsTools
    ? broker.getAiSdkTools({
        modelId,
        signal: request.signal,
        includeNonRead: true,
      })
    : {};
  const anyTools = Object.keys(aiTools).length > 0;
  const maxSteps = getMaxSteps(projectPath);

  const gateChipSolo =
    gate && gateDecisionId
      ? {
          type: "data-gate" as const,
          id: gateDecisionId,
          data: {
            decisionId: gateDecisionId,
            action: evidenceMode ? ("retrieve_evidence" as const) : gate.action,
            actionLabel: evidenceMode
              ? ACTION_LABELS.retrieve_evidence
              : ACTION_LABELS[gate.action],
            taskType: gate.taskType,
            taskLabel: TASK_TYPE_LABELS[gate.taskType],
            stakes: gate.stakes,
            layer: gate.layer,
            confidence: gate.confidence,
            reason: gate.reason,
            probeAgreement,
            escalated,
            costUsd: null as number | null,
          },
        }
      : null;

  try {
    const modelMessages = await convertToModelMessages(
      sanitizeCouncilHistoryForModel(uiMessages as UIMessage[]),
    );

    const systemText = [
      ctx.systemText,
      soloSystemExtra,
      anyTools ? `\n${loadPrompt("tools-policy.md")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = streamText({
      model,
      system: systemText,
      messages: modelMessages,
      abortSignal: request.signal,
      ...(Object.keys(aiTools).length > 0
        ? { tools: aiTools, stopWhen: stepCountIs(maxSteps) }
        : {}),
    });

    result.consumeStream();

    void (async () => {
      try {
        const text = await result.text;
        const reasoning = await result.reasoningText;
        const usage = await result.usage;
        const providerMeta = await result.providerMetadata;
        const cost =
          (
            providerMeta?.openrouter as
              { usage?: { cost?: number } } | undefined
          )?.usage?.cost ?? undefined;

        const parts: unknown[] = [];
        if (reasoning) {
          parts.push({ type: "reasoning", text: reasoning });
        }
        parts.push(...toolPartsSolo);
        parts.push({ type: "text", text });
        if (gateChipSolo) {
          gateChipSolo.data.costUsd = cost ?? null;
          parts.push(gateChipSolo);
          if (gateDecisionId) {
            updateGateDecision(projectPath, gateDecisionId, {
              actualCostUsd: cost ?? null,
              models: [modelId],
            });
          }
        }

        let mockOutput: ScribeOutput | null = null;
        if (process.env.ARAITCHI_MOCK_SCRIBE) {
          try {
            mockOutput = JSON.parse(
              process.env.ARAITCHI_MOCK_SCRIBE,
            ) as ScribeOutput;
          } catch {
            mockOutput = null;
          }
        }
        // Scribe runs after the reply stream finishes; does not delay tokens.
        const scribeSummary = await runScribe({
          projectPath,
          chatId,
          messageId: assistantId,
          userText: lastUserText,
          replyText: text,
          sourceModel: modelId,
          apiKey,
          mockOutput,
        }).catch(() => null);

        if (scribeSummary) {
          parts.push({
            type: "data-scribe",
            id: scribeSummary.batchId,
            data: scribeSummary,
          });
        }

        try {
          const { attachTrustMeta } = await import("@/lib/server/trust/attach");
          const trust = await attachTrustMeta({
            projectPath,
            messageId: assistantId,
            text,
          });
          parts.push(trust.part);
        } catch {
          /* citation check is best-effort */
        }

        updateMessage(assistantId, {
          parts,
          modelId,
          usage: {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            cost,
            scribeCost: scribeSummary?.costUsd ?? undefined,
          },
        });
        persistSessionTranscript(chatId);
      } catch {
        // aborted or failed mid-stream
      } finally {
        await built.close();
      }
    })();

    const uiStreamOptions = {
      originalMessages: uiMessages as UIMessage[],
      generateMessageId: () => assistantId,
      messageMetadata: async ({ part }: { part: { type: string } }) => {
        if (part.type !== "finish") return undefined;
        const usage = await result.usage;
        const providerMeta = await result.providerMetadata;
        const cost =
          (
            providerMeta?.openrouter as
              { usage?: { cost?: number } } | undefined
          )?.usage?.cost ?? undefined;
        return {
          modelId,
          usage: {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            cost,
          },
          projectContext: {
            brief: true,
            pinnedCount: ctx.pinnedCount,
            relevantCount: ctx.relevantCount,
            totalTokens: ctx.totalTokens,
            items: ctx.items,
            vectorUsed: ctx.vectorUsed,
          },
        };
      },
      onError: (error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Chat stream failed";
        return friendlyError(500, message);
      },
    };

    // Always wrap when we have a gate chip and/or tools so data parts reach
    // the client live (toUIMessageStreamResponse alone omits custom data-*).
    if (!anyTools && !gateChipSolo) {
      return result.toUIMessageStreamResponse(uiStreamOptions);
    }

    const uiStream = createUIMessageStream({
      originalMessages: uiMessages as UIMessage[],
      generateId: () => assistantId,
      execute: ({ writer }) => {
        if (gateChipSolo) {
          writer.write(gateChipSolo as never);
        }
        if (anyTools) {
          broker.onToolEvent((event) => {
            writer.write(toolEventPart(event));
          });
        }
        writer.merge(result.toUIMessageStream(uiStreamOptions));
      },
      onError: uiStreamOptions.onError,
    });
    return createUIMessageStreamResponse({ stream: uiStream });
  } catch (error) {
    await built.close();
    const status =
      typeof error === "object" &&
      error &&
      "statusCode" in error &&
      typeof (error as { statusCode: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;

    updateMessage(assistantId, {
      parts: [
        {
          type: "text",
          text: friendlyError(
            status,
            error instanceof Error ? error.message : undefined,
          ),
        },
      ],
    });

    return Response.json(
      { error: friendlyError(status) },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}

async function handleCouncil(input: {
  apiKey: string;
  projectPath: string;
  chatId: string;
  assistantId: string;
  lastUserId: string;
  lastUserText: string;
  uiMessages: UIMessage[];
  allowOverBudget: boolean;
  abortSignal: AbortSignal;
  projectSystem: string;
  contextMeta: {
    pinnedCount: number;
    relevantCount: number;
    totalTokens: number;
    items: unknown[];
    vectorUsed: boolean;
  };
  toggles: ToolToggles;
  toolApprovals?: Record<string, boolean>;
  gate?: Classification | null;
  gateDecisionId?: string | null;
  synthesizerSystem?: string;
  prefilledMembers?: { modelId: string; content: string; cost?: number }[];
  escalated?: boolean;
  probeAgreement?: number | null;
}) {
  let config = getCouncilConfig(input.projectPath);
  const catalog = await listModels();
  if (config.members.length < 3 || !config.synthesizer) {
    const preset =
      config.preset === "budget"
        ? resolveBudgetPreset(catalog)
        : resolveBalancedPreset(catalog);
    config = setCouncilConfig(input.projectPath, {
      members: preset.members,
      synthesizer: preset.synthesizer,
    });
  }

  if (config.members.length < 3 || !config.synthesizer) {
    return Response.json(
      { error: "Council is not configured (need 3 members + synthesizer)" },
      { status: 400 },
    );
  }

  const modelMessages = await convertToModelMessages(
    sanitizeCouncilHistoryForModel(input.uiMessages),
  );
  const contextChars = countContextChars(input.projectSystem, modelMessages);
  const estimate = estimateCouncilCost({
    contextChars,
    config,
    catalog,
  });
  if (estimate.totalHighUsd > config.budgetCapUsd && !input.allowOverBudget) {
    return Response.json(
      {
        error: `Estimated cost up to $${estimate.totalHighUsd.toFixed(4)} exceeds budget cap $${config.budgetCapUsd.toFixed(2)}`,
        code: "OVER_BUDGET",
        estimate,
      },
      { status: 402 },
    );
  }

  insertMessage({
    id: input.assistantId,
    chatId: input.chatId,
    parentId: input.lastUserId,
    role: "assistant",
    parts: [],
    modelId: "council",
  });

  const broker = createBrokerForRequest({
    projectPath: input.projectPath,
    chatId: input.chatId,
    messageId: input.assistantId,
  });
  if (input.toolApprovals) {
    for (const [k, v] of Object.entries(input.toolApprovals)) {
      broker.setApproval(k, v);
    }
  }
  const built = await buildBrokerTools({
    broker,
    projectPath: input.projectPath,
    toggles: input.toggles,
  });
  const maxSteps = getMaxSteps(input.projectPath);
  const toolPartsCouncil: unknown[] = [];

  const stream = createUIMessageStream({
    originalMessages: input.uiMessages,
    generateId: () => input.assistantId,
    execute: async ({ writer }) => {
      const textId = nanoid();
      broker.onToolEvent((event) => {
        const part = toolEventPart(event);
        toolPartsCouncil.push(part);
        writer.write(part);
      });
      try {
        const result = await runCouncil({
          apiKey: input.apiKey,
          config,
          catalog,
          projectSystem: input.projectSystem,
          modelMessages,
          contextChars,
          abortSignal: input.abortSignal,
          allowOverBudget: input.allowOverBudget,
          broker,
          maxSteps,
          synthesizerSystem: input.synthesizerSystem,
          prefilledMembers: input.prefilledMembers,
          hooks: {
            onMember: (event) => {
              writer.write({
                type: "data-member",
                id: event.modelId,
                data: event,
              });
            },
            onSynthesis: (event) => {
              writer.write({
                type: "data-synthesis",
                data: event,
              });
            },
          },
        });

        if (result.error && !result.finalAnswer) {
          writer.write({
            type: "error",
            errorText: result.error,
          });
        }

        const finalText =
          result.finalAnswer || result.error || "Council produced no answer.";

        writer.write({ type: "text-start", id: textId });
        writer.write({
          type: "text-delta",
          id: textId,
          delta: finalText,
        });
        writer.write({ type: "text-end", id: textId });

        if (result.analysis) {
          writer.write({
            type: "data-analysis",
            data: result.analysis,
          });
        }

        writer.write({
          type: "data-council-summary",
          data: result.summary,
        });

        const parts: unknown[] = [
          { type: "text", text: finalText },
          ...toolPartsCouncil,
          ...result.members.map((m) => ({
            type: "data-member",
            id: m.modelId,
            data: {
              phase: "finish",
              modelId: m.modelId,
              lab: m.lab,
              content: m.content,
              status: m.status,
              usage: m.usage,
              cost: m.cost,
              latencyMs: m.latencyMs,
              substitutedFrom: m.substitutedFrom ?? null,
              error: m.error ?? null,
            },
          })),
        ];
        if (result.analysis) {
          parts.push({ type: "data-analysis", data: result.analysis });
        }
        parts.push({ type: "data-council-summary", data: result.summary });

        if (input.gate && input.gateDecisionId) {
          const gateChip = {
            type: "data-gate",
            id: input.gateDecisionId,
            data: {
              decisionId: input.gateDecisionId,
              action: "council" as const,
              actionLabel: ACTION_LABELS.council,
              taskType: input.gate.taskType,
              taskLabel: TASK_TYPE_LABELS[input.gate.taskType],
              stakes: input.gate.stakes,
              layer: input.gate.layer,
              confidence: input.gate.confidence,
              reason: input.gate.reason,
              probeAgreement: input.probeAgreement ?? null,
              escalated: Boolean(input.escalated),
              costUsd: result.summary.totalCost,
            },
          };
          parts.push(gateChip);
          writer.write(gateChip as never);
          updateGateDecision(input.projectPath, input.gateDecisionId, {
            actualCostUsd: result.summary.totalCost,
            escalated: Boolean(input.escalated),
            probeAgreement: input.probeAgreement ?? null,
            models: result.members.map((m) => m.modelId),
            action: "council",
          });
        }

        let mockOutput: ScribeOutput | null = null;
        if (process.env.ARAITCHI_MOCK_SCRIBE) {
          try {
            mockOutput = JSON.parse(
              process.env.ARAITCHI_MOCK_SCRIBE,
            ) as ScribeOutput;
          } catch {
            mockOutput = null;
          }
        }
        const scribeSummary = await runScribe({
          projectPath: input.projectPath,
          chatId: input.chatId,
          messageId: input.assistantId,
          userText: input.lastUserText,
          replyText: finalText,
          sourceModel: config.synthesizer,
          apiKey: input.apiKey,
          councilAnalysisJson: result.analysis
            ? JSON.stringify(result.analysis)
            : null,
          mockOutput,
        }).catch(() => null);

        if (scribeSummary) {
          parts.push({
            type: "data-scribe",
            id: scribeSummary.batchId,
            data: scribeSummary,
          });
          writer.write({
            type: "data-scribe",
            id: scribeSummary.batchId,
            data: scribeSummary,
          });
        }

        try {
          const { attachTrustMeta } = await import("@/lib/server/trust/attach");
          const trust = await attachTrustMeta({
            projectPath: input.projectPath,
            messageId: input.assistantId,
            text: finalText,
          });
          parts.push(trust.part);
          writer.write(trust.part as never);
        } catch {
          /* best-effort */
        }

        updateMessage(input.assistantId, {
          parts,
          modelId: "council",
          usage: {
            cost: result.summary.totalCost,
            scribeCost: scribeSummary?.costUsd ?? undefined,
          },
        });
        persistSessionTranscript(input.chatId);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: string }).code)
            : null;
        const message =
          error instanceof Error ? error.message : "Council failed";

        if (code === "OVER_BUDGET") {
          writer.write({
            type: "error",
            errorText: message,
          });
          updateMessage(input.assistantId, {
            parts: [{ type: "text", text: message }],
          });
          return;
        }

        writer.write({ type: "error", errorText: message });
        updateMessage(input.assistantId, {
          parts: [{ type: "text", text: message }],
        });
      } finally {
        await built.close();
      }
    },
    onError: (error) =>
      error instanceof Error ? error.message : "Council stream failed",
  });

  return createUIMessageStreamResponse({ stream });
}
