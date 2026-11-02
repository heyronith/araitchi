import "server-only";

import { generateText } from "ai";
import { eq } from "drizzle-orm";

import { listMessages } from "@/lib/server/project/chats";
import { getNotebookDb } from "@/lib/server/project/db";
import { sessionSummaries } from "@/lib/server/project/schema";
import { createOpenRouterClient } from "@/lib/server/openrouter";
import * as projectChats from "@/lib/server/project/chats";

import { indexSessionSummary } from "./index";
import { resolveScribeModelId } from "./settings";

const WORD_CAP = 300;

function extractText(parts: unknown[]): string {
  const bits: string[] = [];
  for (const p of parts) {
    if (
      p &&
      typeof p === "object" &&
      (p as { type?: string }).type === "text" &&
      typeof (p as { text?: string }).text === "string"
    ) {
      bits.push((p as { text: string }).text);
    }
  }
  return bits.join("\n");
}

function truncateWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return `${words.slice(0, max).join(" ")}…`;
}

export function getSessionSummary(
  projectPath: string,
  chatId: string,
): { summary: string; messageCount: number; updatedAt: number } | null {
  const row = getNotebookDb(projectPath)
    .select()
    .from(sessionSummaries)
    .where(eq(sessionSummaries.chatId, chatId))
    .get();
  if (!row) return null;
  return {
    summary: row.summary,
    messageCount: row.messageCount,
    updatedAt: row.updatedAt,
  };
}

export function upsertSessionSummary(
  projectPath: string,
  chatId: string,
  summary: string,
  messageCount: number,
): void {
  const db = getNotebookDb(projectPath);
  const now = Date.now();
  const existing = db
    .select()
    .from(sessionSummaries)
    .where(eq(sessionSummaries.chatId, chatId))
    .get();
  if (existing) {
    db.update(sessionSummaries)
      .set({ summary, messageCount, updatedAt: now })
      .where(eq(sessionSummaries.chatId, chatId))
      .run();
  } else {
    db.insert(sessionSummaries)
      .values({ chatId, summary, messageCount, updatedAt: now })
      .run();
  }
  void indexSessionSummary(projectPath, chatId, summary).catch(() => undefined);
}

/**
 * Update rolling summary every 6 messages (or when `force`).
 * Uses the scribe model; ≤ 300 words.
 */
export async function maybeUpdateSessionSummary(input: {
  projectPath: string;
  chatId: string;
  apiKey: string;
  force?: boolean;
}): Promise<string | null> {
  const messages = listMessages(input.projectPath, input.chatId);
  const count = messages.length;
  const existing = getSessionSummary(input.projectPath, input.chatId);
  if (!input.force) {
    if (count < 6) return existing?.summary ?? null;
    if (existing && count - existing.messageCount < 6) {
      return existing.summary;
    }
  }

  const recent = messages.slice(-12);
  const transcript = recent
    .map(
      (m) => `${m.role}: ${extractText(m.parts as unknown[]).slice(0, 1500)}`,
    )
    .join("\n\n");

  let summary: string;
  if (process.env.ARAITCHI_MOCK_SCRIBE || process.env.VITEST) {
    summary = truncateWords(
      existing?.summary
        ? `${existing.summary} ${transcript.slice(0, 200)}`
        : `Session notes: ${transcript.slice(0, 400)}`,
      WORD_CAP,
    );
  } else {
    try {
      const openrouter = createOpenRouterClient(input.apiKey);
      const modelId = resolveScribeModelId(input.projectPath);
      const model = openrouter(modelId);
      const result = await generateText({
        model,
        system:
          "Summarize this research chat in ≤300 words. Keep durable facts, hypotheses, decisions, and open questions. No chit-chat.",
        prompt: [
          existing?.summary ? `Previous summary:\n${existing.summary}\n\n` : "",
          `Recent messages:\n${transcript}`,
        ].join(""),
        maxOutputTokens: 1024,
      });
      summary = truncateWords(result.text, WORD_CAP);
    } catch {
      return existing?.summary ?? null;
    }
  }

  upsertSessionSummary(input.projectPath, input.chatId, summary, count);
  try {
    projectChats.persistSessionTranscript(input.projectPath, input.chatId);
  } catch {
    // ignore
  }
  return summary;
}
