import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { listEmbeddingRows } from "@/lib/server/memory/index";
import { getEmbedder } from "@/lib/server/memory/embedder";
import { getMemorySettings } from "@/lib/server/memory/settings";
import { cosine } from "@/lib/server/memory/vector";
import { getRecord, listRecords, softDeleteRecord, updateRecord } from "@/lib/server/project/records";
import { getNotebookDb } from "@/lib/server/project/db";
import { embeddings } from "@/lib/server/project/schema";
import {
  getProjectSetting,
  setProjectSetting,
} from "@/lib/server/project/settings";
import type { RecordType } from "@/lib/server/project/types";

const MERGE_PROPOSALS_KEY = "memory.tidyMergeProposals";

export type DuplicateCluster = {
  type: RecordType;
  ids: string[];
  titles: string[];
  /** Minimum pairwise cosine within the cluster. */
  minScore: number;
};

export type MergeProposal = {
  id: string;
  type: RecordType;
  keepId: string;
  absorbIds: string[];
  titles: string[];
  minScore: number;
  status: "pending" | "applied" | "dismissed";
  createdAt: number;
};

class UnionFind {
  parent = new Map<string, string>();

  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    while (p !== (this.parent.get(p) ?? p)) {
      p = this.parent.get(p)!;
    }
    this.parent.set(x, p);
    return p;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
}

export async function findDuplicateClusters(
  projectPath: string,
  threshold = 0.92,
): Promise<DuplicateCluster[]> {
  const settings = getMemorySettings(projectPath);
  let rows: Awaited<ReturnType<typeof listEmbeddingRows>>;
  try {
    const embedder = await getEmbedder(settings.embeddingModel);
    rows = listEmbeddingRows(projectPath, embedder.modelId).filter(
      (r) => r.ownerType === "record" && r.chunkIdx === 0,
    );
  } catch {
    return [];
  }

  const byType = new Map<RecordType, typeof rows>();
  for (const r of rows) {
    const rec = getRecord(projectPath, r.ownerId);
    if (!rec || rec.deletedAt) continue;
    let list = byType.get(rec.type);
    if (!list) {
      list = [];
      byType.set(rec.type, list);
    }
    list.push(r);
  }

  const clusters: DuplicateCluster[] = [];

  for (const [type, typeRows] of byType) {
    if (typeRows.length < 2) continue;
    const uf = new UnionFind();
    const pairScores = new Map<string, number>();

    for (let i = 0; i < typeRows.length; i++) {
      uf.add(typeRows[i]!.ownerId);
      for (let j = i + 1; j < typeRows.length; j++) {
        const a = typeRows[i]!;
        const b = typeRows[j]!;
        const score = cosine(a.vector, b.vector);
        if (score >= threshold) {
          uf.union(a.ownerId, b.ownerId);
          pairScores.set(`${a.ownerId}:${b.ownerId}`, score);
          pairScores.set(`${b.ownerId}:${a.ownerId}`, score);
        }
      }
    }

    const groups = new Map<string, string[]>();
    for (const r of typeRows) {
      const root = uf.find(r.ownerId);
      let g = groups.get(root);
      if (!g) {
        g = [];
        groups.set(root, g);
      }
      g.push(r.ownerId);
    }

    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      let minScore = 1;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const s = pairScores.get(`${ids[i]}:${ids[j]}`);
          if (s !== undefined) minScore = Math.min(minScore, s);
        }
      }
      const titles = ids.map((id) => getRecord(projectPath, id)?.title ?? id);
      clusters.push({ type, ids, titles, minScore });
    }
  }

  clusters.sort((a, b) => b.minScore - a.minScore);
  return clusters;
}

export function listMergeProposals(projectPath: string): MergeProposal[] {
  return getProjectSetting<MergeProposal[]>(
    projectPath,
    MERGE_PROPOSALS_KEY,
    [],
  );
}

export async function proposeMerges(
  projectPath: string,
  threshold = 0.92,
): Promise<MergeProposal[]> {
  const clusters = await findDuplicateClusters(projectPath, threshold);
  const existing = listMergeProposals(projectPath).filter(
    (p) => p.status === "pending",
  );
  const pendingKeys = new Set(
    existing.map((p) => [...p.absorbIds, p.keepId].sort().join("|")),
  );

  const now = Date.now();
  const added: MergeProposal[] = [];

  for (const c of clusters) {
    const sorted = [...c.ids].sort((a, b) => {
      const ra = getRecord(projectPath, a);
      const rb = getRecord(projectPath, b);
      return (ra?.createdAt ?? 0) - (rb?.createdAt ?? 0);
    });
    const keepId = sorted[0]!;
    const absorbIds = sorted.slice(1);
    const key = [...absorbIds, keepId].sort().join("|");
    if (pendingKeys.has(key)) continue;
    pendingKeys.add(key);
    added.push({
      id: nanoid(),
      type: c.type,
      keepId,
      absorbIds,
      titles: c.titles,
      minScore: c.minScore,
      status: "pending",
      createdAt: now,
    });
  }

  const next = [...existing, ...added];
  setProjectSetting(projectPath, MERGE_PROPOSALS_KEY, next);
  return next;
}

export async function applyMerge(
  projectPath: string,
  keepId: string,
  absorbIds: string[],
): Promise<{ ok: boolean; keepId: string }> {
  const keep = getRecord(projectPath, keepId);
  if (!keep || keep.deletedAt) return { ok: false, keepId };

  let body = keep.body;
  for (const id of absorbIds) {
    if (id === keepId) continue;
    const rec = getRecord(projectPath, id);
    if (!rec || rec.deletedAt) continue;
    body = `${body.trim()}\n\n---\n\nMerged from "${rec.title}":\n${rec.body.trim()}`;
    softDeleteRecord(projectPath, id);
    getNotebookDb(projectPath)
      .delete(embeddings)
      .where(
        and(eq(embeddings.ownerType, "record"), eq(embeddings.ownerId, id)),
      )
      .run();
  }

  updateRecord(projectPath, keepId, { body });
  const proposals = listMergeProposals(projectPath).map((p) =>
    p.keepId === keepId && p.absorbIds.every((a) => absorbIds.includes(a))
      ? { ...p, status: "applied" as const }
      : p,
  );
  setProjectSetting(projectPath, MERGE_PROPOSALS_KEY, proposals);
  return { ok: true, keepId };
}

export function archiveStaleQuestions(
  projectPath: string,
  days = 60,
): { archived: number; ids: string[] } {
  const cutoff = Date.now() - days * 86_400_000;
  const questions = listRecords(projectPath, { type: "question" });
  const ids: string[] = [];

  for (const q of questions) {
    if (q.status === "archived") continue;
    const stale =
      q.updatedAt < cutoff &&
      (q.status === "answered" || q.status === "open" || q.status == null);
    if (!stale) continue;
    updateRecord(projectPath, q.id, { status: "archived" });
    ids.push(q.id);
  }

  return { archived: ids.length, ids };
}
