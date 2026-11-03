import "server-only";

import { getNotebookSqlite } from "@/lib/server/project/db";
import { getRecord, listRecords } from "@/lib/server/project/records";
import type { RecordType } from "@/lib/server/project/types";

import { getEmbedder } from "./embedder";
import { listEmbeddingRows } from "./index";
import { getMemorySettings } from "./settings";
import type { EmbeddingOwnerType, HybridHit } from "./types";
import { cosine, rrfMerge } from "./vector";

export type SearchOptions = {
  query: string;
  types?: EmbeddingOwnerType[];
  recordTypes?: RecordType[];
  status?: string;
  limit?: number;
  /** Exclude session summaries for this chat id (current chat). */
  excludeChatId?: string;
};

function ftsRecordHits(
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
        `SELECT r.id AS id, bm25(records_fts) AS score,
                r.title || char(10) || r.body AS text
         FROM records_fts f
         JOIN records r ON r.rowid = f.rowid
         WHERE records_fts MATCH ?
           AND r.deleted_at IS NULL
         ORDER BY score
         LIMIT ?`,
      )
      .all(match, limit) as { id: string; score: number; text: string }[];
    return rows
      .map((r) => ({
        id: `record:${r.id}:0`,
        score: -r.score,
        text: r.text,
      }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

function keywordFallback(
  projectPath: string,
  query: string,
  opts: SearchOptions,
): HybridHit[] {
  const limit = opts.limit ?? 10;
  const records = listRecords(projectPath, { query });
  const hits: HybridHit[] = [];
  for (const r of records) {
    if (opts.recordTypes && !opts.recordTypes.includes(r.type)) continue;
    if (opts.status && r.status !== opts.status) continue;
    if (opts.types && !opts.types.includes("record")) continue;
    hits.push({
      ownerType: "record",
      ownerId: r.id,
      chunkIdx: 0,
      score: r.pinned ? 2 : 1,
      text: `${r.title}\n${r.body}`,
      meta: {
        type: r.type,
        title: r.title,
        status: r.status,
        pinned: r.pinned,
      },
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

type VecRow = {
  id: string;
  score: number;
  ownerType: EmbeddingOwnerType;
  ownerId: string;
  chunkIdx: number;
};

/**
 * Hybrid FTS5 BM25 + vector cosine via reciprocal-rank fusion.
 * Falls back to FTS/keyword when the embedder is unavailable.
 */
export async function hybridSearch(
  projectPath: string,
  opts: SearchOptions,
): Promise<{ hits: HybridHit[]; vectorUsed: boolean }> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
  const q = opts.query.trim();
  if (!q) return { hits: [], vectorUsed: false };

  const settings = getMemorySettings(projectPath);
  const fts = ftsRecordHits(projectPath, q, limit * 3);

  let vectorUsed = false;
  let vecScored: VecRow[] = [];

  try {
    const embedder = await getEmbedder(settings.embeddingModel);
    const [qVec] = await embedder.embed([q], { isQuery: true });
    const rows = listEmbeddingRows(projectPath, embedder.modelId);
    vecScored = rows
      .filter((r) => {
        if (opts.types && !opts.types.includes(r.ownerType)) return false;
        if (
          opts.excludeChatId &&
          r.ownerType === "session_summary" &&
          r.ownerId === opts.excludeChatId
        ) {
          return false;
        }
        return true;
      })
      .map((r) => ({
        id: `${r.ownerType}:${r.ownerId}:${r.chunkIdx}`,
        score: cosine(qVec!, r.vector),
        ownerType: r.ownerType,
        ownerId: r.ownerId,
        chunkIdx: r.chunkIdx,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 3);
    vectorUsed = true;
  } catch {
    vectorUsed = false;
  }

  if (!vectorUsed && fts.length === 0) {
    return { hits: keywordFallback(projectPath, q, opts), vectorUsed: false };
  }

  const fused = rrfMerge([
    fts.map((f) => ({ id: f.id, score: f.score })),
    vecScored.map((s) => ({ id: s.id, score: s.score })),
  ]);

  const vecMap = new Map(vecScored.map((v) => [v.id, v]));
  const ftsMap = new Map(fts.map((f) => [f.id, f]));

  const hits: HybridHit[] = [];
  for (const { id, score } of fused) {
    const parts = id.split(":");
    const ownerType = parts[0] as EmbeddingOwnerType;
    const ownerId = parts[1] ?? "";
    const chunkIdx = Number(parts[2]) || 0;
    if (opts.types && !opts.types.includes(ownerType)) continue;

    let text = ftsMap.get(id)?.text ?? "";
    let meta: Record<string, unknown> | undefined;
    let boost = 0;

    if (ownerType === "record") {
      const rec = getRecord(projectPath, ownerId);
      if (!rec || rec.deletedAt) continue;
      if (opts.recordTypes && !opts.recordTypes.includes(rec.type)) continue;
      if (opts.status && rec.status !== opts.status) continue;
      text = `${rec.title}\n${rec.body}`;
      meta = {
        type: rec.type,
        title: rec.title,
        status: rec.status,
        pinned: rec.pinned,
      };
      if (rec.pinned) boost += 0.05;
      // Prefer newest records so superseded facts lose to later updates.
      const ageDays = Math.max(0, (Date.now() - rec.updatedAt) / 86_400_000);
      boost += 0.12 / (1 + ageDays);
      if (ageDays < 1) boost += 0.08;
      else if (ageDays < 7) boost += 0.04;
      meta = { ...meta, updatedAt: rec.updatedAt };
    } else if (!vecMap.has(id) && !text) {
      continue;
    }

    hits.push({
      ownerType,
      ownerId,
      chunkIdx,
      score: score + boost,
      text,
      meta,
    });
    if (hits.length >= limit) break;
  }

  hits.sort((a, b) => b.score - a.score);
  return { hits, vectorUsed };
}

/** Find same-type record with cosine ≥ threshold to an embedding of `text`. */
export async function findNearDuplicate(
  projectPath: string,
  type: RecordType,
  text: string,
  threshold = 0.9,
): Promise<{ id: string; score: number } | null> {
  const settings = getMemorySettings(projectPath);
  try {
    const embedder = await getEmbedder(settings.embeddingModel);
    const [vec] = await embedder.embed([text], { isQuery: false });
    const rows = listEmbeddingRows(projectPath, embedder.modelId).filter(
      (r) => r.ownerType === "record",
    );
    let best: { id: string; score: number } | null = null;
    for (const r of rows) {
      const rec = getRecord(projectPath, r.ownerId);
      if (!rec || rec.deletedAt || rec.type !== type) continue;
      const score = cosine(vec!, r.vector);
      if (score >= threshold && (!best || score > best.score)) {
        best = { id: rec.id, score };
      }
    }
    return best;
  } catch {
    return null;
  }
}
