import "server-only";

import type { StoredMessage } from "@/lib/chat/branches";

import * as projectChats from "./project/chats";
import { tryCurrentProjectPath } from "./project/registry";
import { ensureScratchProject } from "./project/scratch";

function projectPath(): string {
  return tryCurrentProjectPath() ?? ensureScratchProject().path;
}

export type ChatSummary = projectChats.ChatSummary;

export function listChats(): ChatSummary[] {
  return projectChats.listChats(projectPath());
}

export function createChat(title = "New chat"): ChatSummary {
  return projectChats.createChat(projectPath(), title);
}

export function renameChat(id: string, title: string): boolean {
  return projectChats.renameChat(projectPath(), id, title);
}

export function deleteChat(id: string): boolean {
  return projectChats.deleteChat(projectPath(), id);
}

export function touchChat(id: string, title?: string): void {
  projectChats.touchChat(projectPath(), id, title);
}

export function listMessages(chatId: string): StoredMessage[] {
  return projectChats.listMessages(projectPath(), chatId);
}

export function getChatDetail(chatId: string, activeLeafId?: string | null) {
  return projectChats.getChatDetail(projectPath(), chatId, activeLeafId);
}

export function insertMessage(
  input: Parameters<typeof projectChats.insertMessage>[1],
): StoredMessage {
  return projectChats.insertMessage(projectPath(), input);
}

export function updateMessage(
  id: string,
  patch: Parameters<typeof projectChats.updateMessage>[2],
): void {
  projectChats.updateMessage(projectPath(), id, patch);
}

export function ensureChat(chatId: string): ChatSummary {
  return projectChats.ensureChat(projectPath(), chatId);
}

export function persistSessionTranscript(chatId: string): void {
  projectChats.persistSessionTranscript(projectPath(), chatId);
}
