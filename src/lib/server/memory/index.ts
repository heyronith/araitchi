import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getNotebookDb } from "@/lib/server/project/db";
import { getRecord, listRecords } from "@/lib/server/project/records";
import { embeddings } from "@/lib/server/project/schema";
import { splitIntoChunks } from "@/lib/server/tools/documents/chunk";

import { getEmbedder } from "./embedder";
import { getMemorySettings } from "./settings";
import type { EmbeddingOwnerType } from "./types";
import { bufferToFloat32, float32ToBuffer, textHash } from "./vector";

export type IndexProgress = {
  total: number;
  done: number;
  phase: string;
};

const progressByProject = new Map<string, IndexProgress>();
const progressListeners = new Map<string, Set<(p: IndexProgress) => void>>();

export function getIndexProgress(projectPath: string): IndexProgress | null {
  return progressByProject.get(projectPath) ?? null;
}

export function onIndexProgress(
  projectPath: string,
  fn: (p: IndexProgress) => void,
): () => void {
  let set = progressListeners.get(projectPath);
  if (!set) {
    set = new Set();
    progressListeners.set(projectPath, set);
  }
  set.add(fn);
  const cur = progressByProject.get(projectPath);
  if (cur) fn(cur);
  return () => set!.delete(fn);
}

function emitProgress(projectPath: string, p: IndexProgress) {
  progressByProject.set(projectPath, p);
  for (const fn of progressListeners.get(projectPath) ?? []) fn(p);
}

async function upsertEmbedding(input: {
  projectPath: string;
  ownerType: EmbeddingOwnerType;
  ownerId: string;
  chunkIdx: number;
  text: string;
  model: string;
  vector: Float32Array;
}) {
  const hash = textHash(input.text);
  const db = getNotebookDb(input.projectPath);
  const existing = db
    .select()
    .from(embeddings)
    .where(
      and(
        eq(embeddings.ownerType, input.ownerType),
        eq(embeddings.ownerId, input.ownerId),
        eq(embeddings.chunkIdx, input.chunkIdx),
        eq(embeddings.model, input.model),
      ),
    )
    .get();
  if (existing && existing.textHash === hash) return { wrote: false };
  const now = Date.now();
  const buf = float32ToBuffer(input.vector);
  if (existing) {
    db.update(embeddings)
      .set({ textHash: hash, vector: buf, updatedAt: now })
      .where(eq(embeddings.id, existing.id))
      .run();
  } else {
    db.insert(embeddings)
      .values({
        id: nanoid(),
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        chunkIdx: input.chunkIdx,
        textHash: hash,
        model: input.model,
        vector: buf,
        updatedAt: now,
      })
      .run();
  }
  return { wrote: true };
}

export async function indexRecord(
  projectPath: string,
  recordId: string,
): Promise<void> {
  const rec = getRecord(projectPath, recordId);
  if (!rec || rec.deletedAt) return;
  const settings = getMemorySettings(projectPath);
  const embedder = await getEmbedder(settings.embeddingModel);
  const text = `${rec.title}\n${rec.body}`.trim();
  if (!text) return;
  const [vec] = await embedder.embed([text], { isQuery: false });
  await upsertEmbedding({
    projectPath,
    ownerType: "record",
    ownerId: recordId,
    chunkIdx: 0,
    text,
    model: embedder.modelId,
    vector: vec!,
  });
}

export async function indexSessionSummary(
  projectPath: string,
  chatId: string,
  summary: string,
): Promise<void> {
  const settings = getMemorySettings(projectPath);
  const embedder = await getEmbedder(settings.embeddingModel);
  const [vec] = await embedder.embed([summary], { isQuery: false });
  await upsertEmbedding({
    projectPath,
    ownerType: "session_summary",
    ownerId: chatId,
    chunkIdx: 0,
    text: summary,
    model: embedder.modelId,
    vector: vec!,
  });
}

export async function indexTextChunks(input: {
  projectPath: string;
  ownerType: EmbeddingOwnerType;
  ownerId: string;
  text: string;
  chunkChars?: number;
}): Promise<number> {
  const settings = getMemorySettings(input.projectPath);
  const embedder = await getEmbedder(settings.embeddingModel);
  const chunks = splitIntoChunks(input.text, input.chunkChars ?? 800);
  if (chunks.length === 0) return 0;
  const vectors = await embedder.embed(chunks, { isQuery: false });
  let n = 0;
  for (let i = 0; i < chunks.length; i++) {
    const r = await upsertEmbedding({
      projectPath: input.projectPath,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      chunkIdx: i,
      text: chunks[i]!,
      model: embedder.modelId,
      vector: vectors[i]!,
    });
    if (r.wrote) n++;
  }
  return n;
}

/** Full rebuild of record (+ optional doc/paper) embeddings for a project. */
export async function rebuildIndex(
  projectPath: string,
): Promise<IndexProgress> {
  const records = listRecords(projectPath);
  const total = Math.max(1, records.length);
  emitProgress(projectPath, { total, done: 0, phase: "records" });
  let done = 0;
  for (const r of records) {
    try {
      await indexRecord(projectPath, r.id);
    } catch {
      // continue
    }
    done++;
    emitProgress(projectPath, { total, done, phase: "records" });
  }
  const final = { total, done, phase: "done" };
  emitProgress(projectPath, final);
  return final;
}

/** Background backfill after project open (non-blocking). */
export function startBackfillIfNeeded(projectPath: string): void {
  const db = getNotebookDb(projectPath);
  const embCount = db.select().from(embeddings).all().length;
  const recCount = listRecords(projectPath).length;
  if (recCount === 0 || embCount >= recCount) return;
  void rebuildIndex(projectPath).catch(() => undefined);
}

export function listEmbeddingRows(
  projectPath: string,
  model: string,
): {
  id: string;
  ownerType: EmbeddingOwnerType;
  ownerId: string;
  chunkIdx: number;
  textHash: string;
  vector: Float32Array;
}[] {
  return getNotebookDb(projectPath)
    .select()
    .from(embeddings)
    .where(eq(embeddings.model, model))
    .all()
    .map((r) => ({
      id: r.id,
      ownerType: r.ownerType as EmbeddingOwnerType,
      ownerId: r.ownerId,
      chunkIdx: r.chunkIdx,
      textHash: r.textHash,
      vector: bufferToFloat32(r.vector as Buffer),
    }));
}
