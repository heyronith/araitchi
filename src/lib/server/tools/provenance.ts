import "server-only";

import { nanoid } from "nanoid";

import { getNotebookDb } from "@/lib/server/project/db";
import { toolCalls } from "@/lib/server/project/schema";

import type { ToolSource } from "./types";

export function insertToolCall(input: {
  projectPath: string;
  id?: string;
  chatId: string;
  messageId?: string | null;
  modelId?: string | null;
  tool: string;
  args: unknown;
  status: string;
  cached: boolean;
  durationMs: number;
  costUsd?: number | null;
  sources?: ToolSource[];
}): string {
  const id = input.id ?? nanoid();
  getNotebookDb(input.projectPath)
    .insert(toolCalls)
    .values({
      id,
      chatId: input.chatId,
      messageId: input.messageId ?? null,
      modelId: input.modelId ?? null,
      tool: input.tool,
      args: JSON.stringify(input.args ?? null),
      status: input.status,
      cached: input.cached,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      costUsd: input.costUsd ?? null,
      sources: input.sources ? JSON.stringify(input.sources) : null,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
  return id;
}
