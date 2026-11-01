import "server-only";

import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  buildMessageForest,
  resolveActiveBranch,
  truncateTitle,
  type StoredMessage,
} from "@/lib/chat/branches";

import { getAppDb } from "./db/client";
import { chats, messages } from "./db/schema";

export type ChatSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export function listChats(): ChatSummary[] {
  return getAppDb()
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

export function createChat(title = "New chat"): ChatSummary {
  const now = Date.now();
  const id = nanoid();
  getAppDb()
    .insert(chats)
    .values({ id, title, createdAt: now, updatedAt: now })
    .run();
  return { id, title, createdAt: now, updatedAt: now };
}

export function renameChat(id: string, title: string): boolean {
  const now = Date.now();
  const result = getAppDb()
    .update(chats)
    .set({ title: truncateTitle(title, 80), updatedAt: now })
    .where(eq(chats.id, id))
    .run();
  return result.changes > 0;
}

export function deleteChat(id: string): boolean {
  getAppDb().delete(messages).where(eq(messages.chatId, id)).run();
  const result = getAppDb().delete(chats).where(eq(chats.id, id)).run();
  return result.changes > 0;
}

export function touchChat(id: string, title?: string): void {
  const now = Date.now();
  if (title) {
    getAppDb()
      .update(chats)
      .set({ updatedAt: now, title })
      .where(eq(chats.id, id))
      .run();
  } else {
    getAppDb()
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

export function listMessages(chatId: string): StoredMessage[] {
  return getAppDb()
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

export function getChatDetail(chatId: string, activeLeafId?: string | null) {
  const chat = getAppDb()
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();
  if (!chat) return null;

  const all = listMessages(chatId);
  const forest = buildMessageForest(all);
  const activeBranch = resolveActiveBranch(all, activeLeafId);

  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: all,
    forest,
    activeBranch,
  };
}

export function insertMessage(input: {
  id?: string;
  chatId: string;
  parentId: string | null;
  role: "user" | "assistant" | "system";
  parts: unknown[];
  modelId?: string | null;
  usage?: StoredMessage["usage"];
}): StoredMessage {
  const id = input.id ?? nanoid();
  const createdAt = Date.now();
  getAppDb()
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
    const existing = getAppDb()
      .select()
      .from(chats)
      .where(eq(chats.id, input.chatId))
      .get();
    if (existing && (existing.title === "New chat" || !existing.title)) {
      touchChat(input.chatId, truncateTitle(text));
    } else {
      touchChat(input.chatId);
    }
  } else {
    touchChat(input.chatId);
  }

  return {
    id,
    chatId: input.chatId,
    parentId: input.parentId,
    role: input.role,
    parts: input.parts,
    modelId: input.modelId ?? null,
    usage: input.usage ?? null,
    createdAt,
  };
}

export function updateMessage(
  id: string,
  patch: {
    parts?: unknown[];
    usage?: StoredMessage["usage"];
    modelId?: string | null;
  },
): void {
  const existing = getAppDb()
    .select()
    .from(messages)
    .where(eq(messages.id, id))
    .get();
  if (!existing) return;

  getAppDb()
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

export function ensureChat(chatId: string): ChatSummary {
  const existing = getAppDb()
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
  getAppDb()
    .insert(chats)
    .values({ id: chatId, title: "New chat", createdAt: now, updatedAt: now })
    .run();
  return { id: chatId, title: "New chat", createdAt: now, updatedAt: now };
}
