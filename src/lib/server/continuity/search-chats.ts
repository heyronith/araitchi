import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getEmbedder } from "@/lib/server/memory/embedder";
import { getMemorySettings } from "@/lib/server/memory/settings";
import {
  bufferToFloat32,
  cosine,
  float32ToBuffer,
  rrfMerge,
  textHash,
} from "@/lib/server/memory/vector";
import { getNotebookDb, getNotebookSqlite } from "@/lib/server/project/db";
import { embeddings, messageChunks } from "@/lib/server/project/schema";
import { splitIntoChunks } from "@/lib/server/tools/documents/chunk";

export type IndexedMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  parts: unknown[];
  modelId?: string | null;
  createdAt: number;
};

export type ChatSearchHit = {
  chatId: string;
  messageId: string;
  role: string;
  modelId: string | null;
  snippet: string;
  createdAt: number;
  score?: number;
};

function extractText(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (p && typeof p === "object" && "text" in p) {
        return String((p as { text?: string }).text ?? "");
      }
      return "";
    })
    .join("\n")
    .trim();
}

function snippetFrom(text: string, query: string, max = 200): string {
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  if (q) {
    const idx = lower.indexOf(q.split(/\s+/)[0] ?? "");
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      return `${start > 0 ? "…" : ""}${text.slice(start, start + max)}${start + max < text.length ? "…" : ""}`;
    }
  }
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function deleteMessageIndex(projectPath: string, messageId: string): void {
  const db = getNotebookDb(projectPath);
  const chunkRows = db
    .select({ id: messageChunks.id })
    .from(messageChunks)
    .where(eq(messageChunks.messageId, messageId))
    .all();
  const chunkIds = chunkRows.map((r) => r.id);
  if (chunkIds.length) {
    db.delete(embeddings)
      .where(
        and(
          eq(embeddings.ownerType, "message_chunk"),
          inArray(embeddings.ownerId, chunkIds),
        ),
      )
      .run();
    db.delete(messageChunks)
      .where(eq(messageChunks.messageId, messageId))
      .run();
  }
}

async function upsertChunkEmbedding(input: {
  projectPath: string;
  chunkId: string;
  chunkIdx: number;
  text: string;
  model: string;
  vector: Float32Array;
}): Promise<void> {
  const db = getNotebookDb(input.projectPath);
  const hash = textHash(input.text);
  const existing = db
    .select()
    .from(embeddings)
    .where(
      and(
        eq(embeddings.ownerType, "message_chunk"),
        eq(embeddings.ownerId, input.chunkId),
        eq(embeddings.chunkIdx, input.chunkIdx),
        eq(embeddings.model, input.model),
      ),
    )
    .get();
  const now = Date.now();
  const buf = float32ToBuffer(input.vector);
  if (existing && existing.textHash === hash) return;
  if (existing) {
    db.update(embeddings)
      .set({ textHash: hash, vector: buf, updatedAt: now })
      .where(eq(embeddings.id, existing.id))
      .run();
  } else {
    db.insert(embeddings)
      .values({
        id: nanoid(),
        ownerType: "message_chunk",
        ownerId: input.chunkId,
        chunkIdx: input.chunkIdx,
        textHash: hash,
        model: input.model,
        vector: buf,
        updatedAt: now,
      })
      .run();
  }
}

const indexingByKey = new Map<string, Promise<void>>();

function indexKey(projectPath: string, messageId: string): string {
  return `${projectPath}:${messageId}`;
}

async function indexMessageInner(
  projectPath: string,
  message: IndexedMessage,
): Promise<void> {
  const text = extractText(message.parts);
  deleteMessageIndex(projectPath, message.id);
  if (!text) return;

  const db = getNotebookDb(projectPath);
  const chunks = splitIntoChunks(text, 1200);
  const now = message.createdAt;
  let vectors: Float32Array[] = [];
  let model = "fake";
  try {
    const settings = getMemorySettings(projectPath);
    const embedder = await getEmbedder(settings.embeddingModel);
    model = embedder.modelId;
    vectors = await embedder.embed(chunks, { isQuery: false });
  } catch {
    vectors = [];
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunkId = nanoid();
    const chunkText = chunks[i]!;
    db.insert(messageChunks)
      .values({
        id: chunkId,
        messageId: message.id,
        chatId: message.chatId,
        chunkIdx: i,
        role: message.role,
        modelId: message.modelId ?? null,
        text: chunkText,
        createdAt: now,
      })
      .run();
    if (vectors[i]) {
      await upsertChunkEmbedding({
        projectPath,
        chunkId,
        chunkIdx: 0,
        text: chunkText,
        model,
        vector: vectors[i]!,
      });
    }
  }
}

export async function indexMessage(
  projectPath: string,
  message: IndexedMessage,
): Promise<void> {
  const key = indexKey(projectPath, message.id);
  const prev = indexingByKey.get(key);
  const run = (async () => {
    if (prev) await prev.catch(() => undefined);
    await indexMessageInner(projectPath, message);
  })();
  indexingByKey.set(key, run);
  try {
    await run;
  } finally {
    if (indexingByKey.get(key) === run) indexingByKey.delete(key);
  }
}

export async function indexAllMessages(projectPath: string): Promise<number> {
  const sqlite = getNotebookSqlite(projectPath);
  const rows = sqlite
    .prepare(
      `SELECT id, chat_id AS chatId, role, parts, model_id AS modelId, created_at AS createdAt
       FROM messages ORDER BY created_at ASC`,
    )
    .all() as {
    id: string;
    chatId: string;
    role: string;
    parts: string;
    modelId: string | null;
    createdAt: number;
  }[];

  let count = 0;
  for (const row of rows) {
    let parts: unknown[] = [];
    try {
      parts = JSON.parse(row.parts) as unknown[];
      if (!Array.isArray(parts)) parts = [];
    } catch {
      parts = [];
    }
    await indexMessage(projectPath, {
      id: row.id,
      chatId: row.chatId,
      role: row.role as IndexedMessage["role"],
      parts,
      modelId: row.modelId,
      createdAt: row.createdAt,
    });
    count++;
  }
  return count;
}

function ftsMessageHits(
  projectPath: string,
  query: string,
  limit: number,
): { id: string; score: number; text: string }[] {
  const sqlite = getNotebookSqlite(projectPath);
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (!terms.length) return [];
  const match = terms.join(" OR ");
  try {
    const rows = sqlite
      .prepare(
        `SELECT c.id AS id, bm25(message_chunks_fts) AS score, c.text AS text
         FROM message_chunks_fts f
         JOIN message_chunks c ON c.rowid = f.rowid
         WHERE message_chunks_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(match, limit) as { id: string; score: number; text: string }[];
    return rows
      .map((r) => ({ id: r.id, score: -r.score, text: r.text }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

export async function searchChats(input: {
  projectPath: string;
  query: string;
  limit?: number;
}): Promise<ChatSearchHit[]> {
  const limit = Math.min(20, Math.max(1, input.limit ?? 10));
  const q = input.query.trim();
  if (!q) return [];

  const fts = ftsMessageHits(input.projectPath, q, limit * 3);
  const db = getNotebookDb(input.projectPath);

  let vectorUsed = false;
  type VecRow = { id: string; score: number };
  let vecScored: VecRow[] = [];

  try {
    const settings = getMemorySettings(input.projectPath);
    const embedder = await getEmbedder(settings.embeddingModel);
    const [qVec] = await embedder.embed([q], { isQuery: true });
    const embRows = db
      .select()
      .from(embeddings)
      .where(
        and(
          eq(embeddings.ownerType, "message_chunk"),
          eq(embeddings.model, embedder.modelId),
        ),
      )
      .all();
    vecScored = embRows
      .map((r) => ({
        id: r.ownerId,
        score: cosine(qVec!, bufferToFloat32(r.vector as Buffer)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 3);
    vectorUsed = true;
  } catch {
    vectorUsed = false;
  }

  const fused = vectorUsed
    ? rrfMerge([
        fts.map((f) => ({ id: f.id, score: f.score })),
        vecScored.map((v) => ({ id: v.id, score: v.score })),
      ])
    : fts.map((f) => ({ id: f.id, score: f.score }));

  const ftsMap = new Map(fts.map((f) => [f.id, f]));
  const seenMessages = new Set<string>();
  const hits: ChatSearchHit[] = [];
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

  for (const { id, score } of fused) {
    const chunk = db
      .select()
      .from(messageChunks)
      .where(eq(messageChunks.id, id))
      .get();
    if (!chunk || seenMessages.has(chunk.messageId)) continue;
    const text = ftsMap.get(id)?.text ?? chunk.text;
    const fromFts = ftsMap.has(id);
    if (
      !fromFts &&
      terms.length > 0 &&
      !terms.some((t) => text.toLowerCase().includes(t))
    ) {
      continue;
    }
    seenMessages.add(chunk.messageId);
    hits.push({
      chatId: chunk.chatId,
      messageId: chunk.messageId,
      role: chunk.role,
      modelId: chunk.modelId,
      snippet: snippetFrom(text, q),
      createdAt: chunk.createdAt,
      score,
    });
    if (hits.length >= limit) break;
  }

  return hits;
}

/** Best-effort async indexing after message persistence. */
export function scheduleIndexMessage(
  projectPath: string,
  message: IndexedMessage,
): void {
  void indexMessage(projectPath, message).catch(() => undefined);
}

/** Test helper — wait for pending message indexes. */
export async function flushMessageIndexForTests(
  projectPath: string,
): Promise<void> {
  const prefix = `${projectPath}:`;
  const pending = [...indexingByKey.entries()]
    .filter(([k]) => k.startsWith(prefix))
    .map(([, p]) => p);
  await Promise.allSettled(pending);
}
