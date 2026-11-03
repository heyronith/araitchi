import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getNotebookDb, getNotebookSqlite } from "./db";
import { exportMemoryMd } from "./exporters";
import { records } from "./schema";
import type {
  CreatedBy,
  MemoryRecord,
  RecordStatus,
  RecordType,
} from "./types";

function rowToRecord(row: typeof records.$inferSelect): MemoryRecord {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    type: row.type as RecordType,
    title: row.title,
    body: row.body,
    status: (row.status as RecordStatus) ?? null,
    pinned: row.pinned,
    source: row.source,
    sourceChatId: row.sourceChatId,
    sourceMessageId: row.sourceMessageId,
    tags,
    createdBy: (row.createdBy as CreatedBy) || "user",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export type ListRecordsOptions = {
  type?: RecordType;
  query?: string;
  status?: string;
  includeDeleted?: boolean;
};

function searchFtsIds(projectPath: string, query: string): string[] {
  const sqlite = getNotebookSqlite(projectPath);
  // Escape double quotes for FTS5 phrase safety; use OR of terms.
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (!terms.length) return [];
  const match = terms.join(" OR ");
  const stmt = sqlite.prepare(
    `SELECT r.id AS id
     FROM records_fts f
     JOIN records r ON r.rowid = f.rowid
     WHERE records_fts MATCH ?
       AND r.deleted_at IS NULL`,
  );
  return (stmt.all(match) as { id: string }[]).map((r) => r.id);
}

export function listRecords(
  projectPath: string,
  options: ListRecordsOptions = {},
): MemoryRecord[] {
  let ids: string[] | null = null;
  if (options.query?.trim()) {
    ids = searchFtsIds(projectPath, options.query);
  }

  let rows = getNotebookDb(projectPath)
    .select()
    .from(records)
    .all()
    .map(rowToRecord);

  if (!options.includeDeleted) {
    rows = rows.filter((r) => r.deletedAt == null);
  }
  if (options.type) {
    rows = rows.filter((r) => r.type === options.type);
  }
  if (options.status) {
    rows = rows.filter((r) => r.status === options.status);
  }
  if (ids) {
    const set = new Set(ids);
    rows = rows.filter((r) => set.has(r.id));
  }

  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return rows;
}

export function getRecord(
  projectPath: string,
  id: string,
): MemoryRecord | null {
  const row = getNotebookDb(projectPath)
    .select()
    .from(records)
    .where(eq(records.id, id))
    .get();
  return row ? rowToRecord(row) : null;
}

export function createRecord(
  projectPath: string,
  input: {
    type: RecordType;
    title: string;
    body: string;
    status?: RecordStatus;
    pinned?: boolean;
    source: string;
    sourceChatId?: string | null;
    sourceMessageId?: string | null;
    tags?: string[];
    createdBy?: CreatedBy;
    id?: string;
  },
): MemoryRecord {
  const now = Date.now();
  const id = input.id ?? nanoid();
  getNotebookDb(projectPath)
    .insert(records)
    .values({
      id,
      type: input.type,
      title: input.title,
      body: input.body,
      status: input.status ?? null,
      pinned: input.pinned ?? false,
      source: input.source,
      sourceChatId: input.sourceChatId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      tags: JSON.stringify(input.tags ?? []),
      createdBy: input.createdBy ?? "user",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .run();
  exportMemoryMd(projectPath);
  // Fire-and-forget index update (safe if embedder unavailable).
  void import("@/lib/server/memory/index")
    .then((m) => m.indexRecord(projectPath, id))
    .catch(() => undefined);
  void import("@/lib/server/continuity/state")
    .then((m) => m.rebuildStateMd(projectPath, { note: "record create" }))
    .catch(() => undefined);
  return getRecord(projectPath, id)!;
}

export function updateRecord(
  projectPath: string,
  id: string,
  patch: Partial<{
    title: string;
    body: string;
    status: RecordStatus;
    pinned: boolean;
    tags: string[];
    type: RecordType;
  }>,
): MemoryRecord | null {
  const existing = getRecord(projectPath, id);
  if (!existing || existing.deletedAt) return null;
  const now = Date.now();
  getNotebookDb(projectPath)
    .update(records)
    .set({
      title: patch.title ?? existing.title,
      body: patch.body ?? existing.body,
      status: patch.status !== undefined ? patch.status : existing.status,
      pinned: patch.pinned ?? existing.pinned,
      tags: JSON.stringify(patch.tags ?? existing.tags),
      type: patch.type ?? existing.type,
      updatedAt: now,
    })
    .where(eq(records.id, id))
    .run();
  exportMemoryMd(projectPath);
  void import("@/lib/server/memory/index")
    .then((m) => m.indexRecord(projectPath, id))
    .catch(() => undefined);
  void import("@/lib/server/continuity/state")
    .then((m) => m.rebuildStateMd(projectPath, { note: "record update" }))
    .catch(() => undefined);
  return getRecord(projectPath, id);
}

export function softDeleteRecord(
  projectPath: string,
  id: string,
): MemoryRecord | null {
  const existing = getRecord(projectPath, id);
  if (!existing) return null;
  const now = Date.now();
  getNotebookDb(projectPath)
    .update(records)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(records.id, id))
    .run();
  exportMemoryMd(projectPath);
  return getRecord(projectPath, id);
}

export function restoreRecord(
  projectPath: string,
  id: string,
): MemoryRecord | null {
  const row = getNotebookDb(projectPath)
    .select()
    .from(records)
    .where(eq(records.id, id))
    .get();
  if (!row) return null;
  getNotebookDb(projectPath)
    .update(records)
    .set({ deletedAt: null, updatedAt: Date.now() })
    .where(eq(records.id, id))
    .run();
  exportMemoryMd(projectPath);
  return getRecord(projectPath, id);
}

export function listPinnedRecords(projectPath: string): MemoryRecord[] {
  return listRecords(projectPath).filter((r) => r.pinned);
}
