import "server-only";

import { writeFileSync } from "node:fs";
import path from "node:path";
import { isNull } from "drizzle-orm";

import { resolveActiveBranch, type StoredMessage } from "@/lib/chat/branches";

import { getNotebookDb } from "./db";
import { researchDir } from "./init";
import { records } from "./schema";
import type { MemoryRecord, RecordType } from "./types";

const TYPE_ORDER: RecordType[] = [
  "hypothesis",
  "experiment",
  "decision",
  "paper",
  "question",
  "note",
];

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
    status: (row.status as MemoryRecord["status"]) ?? null,
    pinned: row.pinned,
    source: row.source,
    sourceChatId: row.sourceChatId,
    sourceMessageId: row.sourceMessageId,
    tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function formatRecord(r: MemoryRecord): string {
  const bits = [
    r.pinned ? "pinned" : null,
    r.status ? `status: ${r.status}` : null,
    `source: ${r.source}`,
    new Date(r.updatedAt).toISOString().slice(0, 10),
  ].filter(Boolean);
  const bodyPreview = r.body.trim().split("\n")[0] ?? "";
  return `### ${r.title}\n\n_${bits.join(" · ")}_\n\n${bodyPreview}\n`;
}

export function exportMemoryMd(projectPath: string): string {
  const rows = getNotebookDb(projectPath)
    .select()
    .from(records)
    .where(isNull(records.deletedAt))
    .all()
    .map(rowToRecord);

  rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  const pinned = rows.filter((r) => r.pinned);
  const byType = new Map<RecordType, MemoryRecord[]>();
  for (const t of TYPE_ORDER) byType.set(t, []);
  for (const r of rows) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type)!.push(r);
  }

  const lines: string[] = ["# Memory", ""];
  if (pinned.length) {
    lines.push("## Pinned", "");
    for (const r of pinned) lines.push(formatRecord(r));
  }

  for (const t of TYPE_ORDER) {
    const list = byType.get(t) ?? [];
    if (!list.length) continue;
    lines.push(`## ${t[0]!.toUpperCase()}${t.slice(1)}s`, "");
    for (const r of list.filter((x) => !x.pinned)) {
      lines.push(formatRecord(r));
    }
  }

  if (rows.length === 0) {
    lines.push("_No records yet._", "");
  }

  const out = lines.join("\n");
  writeFileSync(path.join(researchDir(projectPath), "memory.md"), out, "utf8");
  return out;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "chat"
  );
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

export function writeSessionTranscript(
  projectPath: string,
  chat: { id: string; title: string },
  messages: StoredMessage[],
  activeLeafId?: string | null,
): string {
  const branch = resolveActiveBranch(messages, activeLeafId);
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `${date}-${slugify(chat.title)}-${chat.id.slice(0, 8)}.md`;
  const filePath = path.join(researchDir(projectPath), "sessions", fileName);

  const lines = [`# ${chat.title}`, "", `_chat: ${chat.id}_`, ""];

  for (const m of branch) {
    const when = new Date(m.createdAt).toISOString();
    const model = m.modelId ? ` · ${m.modelId}` : "";
    lines.push(
      `## ${m.role}${model}`,
      "",
      `_${when}_`,
      "",
      extractText(m.parts),
      "",
    );
  }

  writeFileSync(filePath, lines.join("\n"), "utf8");
  return filePath;
}
