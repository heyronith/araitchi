import "server-only";

import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  buildMessageForest,
  resolveActiveBranch,
  truncateTitle,
  type StoredMessage,
} from "@/lib/chat/branches";

import { scheduleIndexMessage } from "@/lib/server/continuity/search-chats";
import { getNotebookDb } from "./db";
import { writeSessionTranscript } from "./exporters";
import { chats, messages } from "./schema";

export type ChatSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export function listChats(projectPath: string): ChatSummary[] {
  return getNotebookDb(projectPath)
    .select()
    .from(chats)
    .orderBy(desc(chats.updatedAt))
    .all()
    .map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
}

export function createChat(
  projectPath: string,
  title = "New chat",
): ChatSummary {
  const now = Date.now();
  const id = nanoid();
  getNotebookDb(projectPath)
    .insert(chats)
    .values({ id, title, createdAt: now, updatedAt: now })
    .run();
  return { id, title, createdAt: now, updatedAt: now };
}

export function renameChat(
  projectPath: string,
  id: string,
  title: string,
): boolean {
  const now = Date.now();
  const result = getNotebookDb(projectPath)
    .update(chats)
    .set({ title: truncateTitle(title, 80), updatedAt: now })
    .where(eq(chats.id, id))
    .run();
  return result.changes > 0;
}

export function deleteChat(projectPath: string, id: string): boolean {
  const db = getNotebookDb(projectPath);
  db.delete(messages).where(eq(messages.chatId, id)).run();
  const result = db.delete(chats).where(eq(chats.id, id)).run();
  return result.changes > 0;
}

export function touchChat(
  projectPath: string,
  id: string,
  title?: string,
): void {
  const now = Date.now();
  if (title) {
    getNotebookDb(projectPath)
      .update(chats)
      .set({ updatedAt: now, title })
      .where(eq(chats.id, id))
      .run();
  } else {
    getNotebookDb(projectPath)
      .update(chats)
      .set({ updatedAt: now })
      .where(eq(chats.id, id))
      .run();
  }
}

function parseParts(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseUsage(raw: string | null): StoredMessage["usage"] {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredMessage["usage"];
  } catch {
    return null;
  }
}

export function listMessages(
  projectPath: string,
  chatId: string,
): StoredMessage[] {
  return getNotebookDb(projectPath)
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .all()
    .map((m) => ({
      id: m.id,
      chatId: m.chatId,
      parentId: m.parentId,
      role: m.role as StoredMessage["role"],
      parts: parseParts(m.parts),
      modelId: m.modelId,
      usage: parseUsage(m.usage),
      createdAt: m.createdAt,
    }));
}

export function getChatDetail(
  projectPath: string,
  chatId: string,
  activeLeafId?: string | null,
) {
  const chat = getNotebookDb(projectPath)
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();
  if (!chat) return null;

  const all = listMessages(projectPath, chatId);
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: all,
    forest: buildMessageForest(all),
    activeBranch: resolveActiveBranch(all, activeLeafId),
  };
}

export function insertMessage(
  projectPath: string,
  input: {
    id?: string;
    chatId: string;
    parentId: string | null;
    role: "user" | "assistant" | "system";
    parts: unknown[];
    modelId?: string | null;
    usage?: StoredMessage["usage"];
  },
): StoredMessage {
  const id = input.id ?? nanoid();
  const createdAt = Date.now();
  getNotebookDb(projectPath)
    .insert(messages)
    .values({
      id,
      chatId: input.chatId,
      parentId: input.parentId,
      role: input.role,
      parts: JSON.stringify(input.parts),
      modelId: input.modelId ?? null,
      usage: input.usage ? JSON.stringify(input.usage) : null,
      createdAt,
    })
    .run();

  if (input.role === "user") {
    const text = extractText(input.parts);
    const existing = getNotebookDb(projectPath)
      .select()
      .from(chats)
      .where(eq(chats.id, input.chatId))
      .get();
    if (existing && (existing.title === "New chat" || !existing.title)) {
      touchChat(projectPath, input.chatId, truncateTitle(text));
    } else {
      touchChat(projectPath, input.chatId);
    }
  } else {
    touchChat(projectPath, input.chatId);
  }

  const stored: StoredMessage = {
    id,
    chatId: input.chatId,
    parentId: input.parentId,
    role: input.role,
    parts: input.parts,
    modelId: input.modelId ?? null,
    usage: input.usage ?? null,
    createdAt,
  };

  scheduleIndexMessage(projectPath, stored);

  return stored;
}

export function updateMessage(
  projectPath: string,
  id: string,
  patch: {
    parts?: unknown[];
    usage?: StoredMessage["usage"];
    modelId?: string | null;
  },
): void {
  const existing = getNotebookDb(projectPath)
    .select()
    .from(messages)
    .where(eq(messages.id, id))
    .get();
  if (!existing) return;

  getNotebookDb(projectPath)
    .update(messages)
    .set({
      parts: patch.parts ? JSON.stringify(patch.parts) : existing.parts,
      usage:
        patch.usage !== undefined
          ? patch.usage
            ? JSON.stringify(patch.usage)
            : null
          : existing.usage,
      modelId: patch.modelId !== undefined ? patch.modelId : existing.modelId,
    })
    .where(eq(messages.id, id))
    .run();

  if (patch.parts) {
    let parts: unknown[] = [];
    try {
      parts = JSON.parse(
        patch.parts ? JSON.stringify(patch.parts) : existing.parts,
      ) as unknown[];
    } catch {
      parts = patch.parts;
    }
    scheduleIndexMessage(projectPath, {
      id: existing.id,
      chatId: existing.chatId,
      role: existing.role as StoredMessage["role"],
      parts,
      modelId: patch.modelId !== undefined ? patch.modelId : existing.modelId,
      createdAt: existing.createdAt,
    });
  }
}

function extractText(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (p && typeof p === "object" && "text" in p) {
        return String((p as { text?: string }).text ?? "");
      }
      return "";
    })
    .join("");
}

export function ensureChat(projectPath: string, chatId: string): ChatSummary {
  const existing = getNotebookDb(projectPath)
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();
  if (existing) {
    return {
      id: existing.id,
      title: existing.title,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }
  const now = Date.now();
  getNotebookDb(projectPath)
    .insert(chats)
    .values({
      id: chatId,
      title: "New chat",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { id: chatId, title: "New chat", createdAt: now, updatedAt: now };
}

export function persistSessionTranscript(
  projectPath: string,
  chatId: string,
): void {
  const detail = getChatDetail(projectPath, chatId);
  if (!detail) return;
  writeSessionTranscript(
    projectPath,
    { id: detail.id, title: detail.title },
    detail.messages,
    detail.activeBranch.at(-1)?.id,
  );
}
