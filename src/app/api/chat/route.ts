import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { nanoid } from "nanoid";

import { chatRequestSchema } from "@/lib/chat/validation";
import {
  ensureChat,
  insertMessage,
  listMessages,
  persistSessionTranscript,
  updateMessage,
} from "@/lib/server/chats";
import {
  createOpenRouterClient,
  requireOpenRouterApiKey,
} from "@/lib/server/openrouter";
import { buildProjectSystemContext } from "@/lib/server/project/context";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

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

  const { chatId, modelId, messages: uiMessages } = parsed.data;
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
  insertMessage({
    id: assistantId,
    chatId,
    parentId: lastUser.id,
    role: "assistant",
    parts: [],
    modelId,
  });

  const ctx = buildProjectSystemContext(projectPath);

  const openrouter = createOpenRouterClient(apiKey);
  const model = openrouter(modelId, {
    usage: { include: true },
  });

  try {
    const modelMessages = await convertToModelMessages(
      uiMessages as UIMessage[],
    );

    const result = streamText({
      model,
      system: ctx.systemText,
      messages: modelMessages,
      abortSignal: request.signal,
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
        parts.push({ type: "text", text });

        updateMessage(assistantId, {
          parts,
          modelId,
          usage: {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            cost,
          },
        });
        persistSessionTranscript(chatId);
      } catch {
        // aborted or failed mid-stream; leave partial message
      }
    })();

    return result.toUIMessageStreamResponse({
      originalMessages: uiMessages as UIMessage[],
      generateMessageId: () => assistantId,
      messageMetadata: async ({ part }) => {
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
            pinnedCount: ctx.pinnedCount,
          },
        };
      },
      onError: (error) => {
        const message =
          error instanceof Error ? error.message : "Chat stream failed";
        return friendlyError(500, message);
      },
    });
  } catch (error) {
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
