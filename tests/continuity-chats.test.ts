import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  flushMessageIndexForTests,
  indexAllMessages,
  indexMessage,
  searchChats,
} from "@/lib/server/continuity/search-chats";
import { FakeEmbedder } from "@/lib/server/memory/fake-embedder";
import { setEmbedderForTests } from "@/lib/server/memory/embedder";
import { listEmbeddingRows } from "@/lib/server/memory/index";
import { setMemorySettings } from "@/lib/server/memory/settings";
import {
  closeAllNotebookDbs,
  getNotebookSqlite,
} from "@/lib/server/project/db";
import { createChat, insertMessage } from "@/lib/server/project/chats";
import { ensureResearchStructure } from "@/lib/server/project/init";

afterEach(() => {
  setEmbedderForTests(null);
  closeAllNotebookDbs();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-chat-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "chat-test" });
  setMemorySettings(dir, { embeddingModel: "fake", scribeEnabled: false });
  setEmbedderForTests(new FakeEmbedder());
  return dir;
}

describe("search chats", () => {
  it("indexes messages into chunks + embeddings and finds them via search", async () => {
    const p = tempProject();
    const chat = createChat(p, "Alpha");
    insertMessage(p, {
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [
        { type: "text", text: "We measured caffeine half-life at 5.2 hours." },
      ],
    });
    insertMessage(p, {
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "Noted the caffeine measurement." }],
      modelId: "fake/model",
    });

    await flushMessageIndexForTests(p);
    await indexAllMessages(p);
    const sqlite = getNotebookSqlite(p);
    const chunks = sqlite
      .prepare("SELECT COUNT(*) AS n FROM message_chunks")
      .get() as { n: number };
    expect(chunks.n).toBeGreaterThan(0);
    expect(
      listEmbeddingRows(p, "fake").some((r) => r.ownerType === "message_chunk"),
    ).toBe(true);

    const hits = await searchChats({
      projectPath: p,
      query: "caffeine half-life",
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.snippet.toLowerCase()).toContain("caffeine");
    expect(hits[0]!.chatId).toBe(chat.id);
  });

  it("reindexes on indexMessage after content change", async () => {
    const p = tempProject();
    const chat = createChat(p, "Beta");
    const msg = insertMessage(p, {
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "old keyword xyzzy" }],
    });
    await flushMessageIndexForTests(p);
    let hits = await searchChats({ projectPath: p, query: "xyzzy", limit: 5 });
    expect(hits).toHaveLength(1);

    await indexMessage(p, {
      ...msg,
      parts: [{ type: "text", text: "new keyword plugh" }],
    });
    await flushMessageIndexForTests(p);
    hits = await searchChats({ projectPath: p, query: "plugh", limit: 5 });
    expect(hits).toHaveLength(1);
    hits = await searchChats({ projectPath: p, query: "xyzzy", limit: 5 });
    expect(hits).toHaveLength(0);
  });
});
