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
import { listModels } from "@/lib/server/models";
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
  const mode = parsed.data.mode ?? "solo";
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

  if (mode === "council") {
    return handleCouncil({
      apiKey,
      projectPath,
      chatId,
      assistantId,
      lastUserId: lastUser.id,
      lastUserText,
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
    });
  }

  const modelId = parsed.data.modelId!;
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
  const built = await buildBrokerTools({ broker, projectPath, toggles });
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

  try {
    const modelMessages = await convertToModelMessages(
      sanitizeCouncilHistoryForModel(uiMessages as UIMessage[]),
    );

    const systemText = anyTools
      ? `${ctx.systemText}\n\n${loadPrompt("tools-policy.md")}`
      : ctx.systemText;

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

    if (!anyTools) {
      return result.toUIMessageStreamResponse(uiStreamOptions);
    }

    // With tools, merge the model stream with `data-tool-call` parts so the
    // UI can render tool cards live; the same parts are persisted above.
    const uiStream = createUIMessageStream({
      originalMessages: uiMessages as UIMessage[],
      generateId: () => assistantId,
      execute: ({ writer }) => {
        broker.onToolEvent((event) => {
          writer.write(toolEventPart(event));
        });
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
