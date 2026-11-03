import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getNotebookDb, getNotebookSqlite } from "@/lib/server/project/db";
import { activity } from "@/lib/server/project/schema";

export type ActivityKind =
  | "tool_call"
  | "search"
  | "experiment"
  | "verdict"
  | "scribe"
  | "instruction_suggestion"
  | "index"
  | "state"
  | "other";

export function recordActivity(
  projectPath: string,
  input: { kind: ActivityKind; summary: string; payload?: unknown },
): string {
  const id = nanoid();
  getNotebookDb(projectPath)
    .insert(activity)
    .values({
      id,
      kind: input.kind,
      summary: input.summary.slice(0, 500),
      payload: JSON.stringify(input.payload ?? {}),
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export function listRecentActivity(
  projectPath: string,
  limit = 15,
): { id: string; kind: string; summary: string; createdAt: number }[] {
  return getNotebookDb(projectPath)
    .select({
      id: activity.id,
      kind: activity.kind,
      summary: activity.summary,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .orderBy(desc(activity.createdAt))
    .limit(Math.max(1, Math.min(100, limit)))
    .all();
}

export function searchActivity(
  projectPath: string,
  query: string,
  opts?: { since?: number; limit?: number },
): { id: string; kind: string; summary: string; createdAt: number }[] {
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 20));
  const q = query.trim();
  if (!q) {
    const rows = listRecentActivity(projectPath, limit);
    return opts?.since
      ? rows.filter((r) => r.createdAt >= opts.since!)
      : rows;
  }
  const sqlite = getNotebookSqlite(projectPath);
  try {
    const rows = sqlite
      .prepare(
        `SELECT a.id, a.kind, a.summary, a.created_at as createdAt
         FROM activity_fts f
         JOIN activity a ON a.rowid = f.rowid
         WHERE activity_fts MATCH ?
         ${opts?.since ? "AND a.created_at >= ?" : ""}
         ORDER BY a.created_at DESC
         LIMIT ?`,
      )
      .all(
        ...(opts?.since
          ? [q, opts.since, limit]
          : [q, limit]),
      ) as {
      id: string;
      kind: string;
      summary: string;
      createdAt: number;
    }[];
    return rows;
  } catch {
    return getNotebookDb(projectPath)
      .select({
        id: activity.id,
        kind: activity.kind,
        summary: activity.summary,
        createdAt: activity.createdAt,
      })
      .from(activity)
      .where(sql`${activity.summary} LIKE ${"%" + q + "%"}`)
      .orderBy(desc(activity.createdAt))
      .limit(limit)
      .all();
  }
}

export function formatActivityForContext(
  projectPath: string,
  limit = 15,
): string {
  const rows = listRecentActivity(projectPath, limit);
  if (!rows.length) return "_No recent activity._";
  return rows
    .map((r) => {
      const when = new Date(r.createdAt).toISOString().slice(0, 16);
      return `- [${when}] (${r.kind}) ${r.summary}`;
    })
    .join("\n");
}

/** Test helper */
export function clearActivityForTests(projectPath: string): void {
  getNotebookSqlite(projectPath).exec("DELETE FROM activity");
}
