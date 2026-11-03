import "server-only";

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { denyReasonForRelativePath } from "@/lib/server/tools/repo/paths";
import { getNotebookDb } from "@/lib/server/project/db";
import { readTracker } from "@/lib/server/project/schema";

import { isIgnoredPath } from "./ignore";

export const PAGE_LINES = 400;

type PathResult = { ok: true; abs: string } | { ok: false; error: string };

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Confined project read path check (realpath + ignore + denylist).
 * Does not cap file size — large files are paged.
 */
export function assertSafeProjectPath(
  projectRoot: string,
  relativePath: string,
): PathResult {
  if (!relativePath || relativePath.includes("\0")) {
    return { ok: false, error: "Invalid path" };
  }
  if (path.isAbsolute(relativePath)) {
    return { ok: false, error: "Path must be relative to the project" };
  }

  let rootReal: string;
  try {
    rootReal = realpathSync(projectRoot);
  } catch {
    return { ok: false, error: "Project root not found" };
  }

  const rel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.isAbsolute(rel)) {
    return { ok: false, error: "Path must be relative to the project" };
  }

  const lexical = path.resolve(rootReal, rel);
  if (!isInside(rootReal, lexical)) {
    return { ok: false, error: "Path escapes the project" };
  }

  if (isIgnoredPath(rootReal, path.relative(rootReal, lexical))) {
    return { ok: false, error: "Path is ignored or denied" };
  }

  const lexicalDeny = denyReasonForRelativePath(
    path.relative(rootReal, lexical),
  );
  if (lexicalDeny) return { ok: false, error: lexicalDeny };

  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    return { ok: false, error: "File not found" };
  }
  if (!isInside(rootReal, real)) {
    return { ok: false, error: "Path escapes the project" };
  }
  const realDeny = denyReasonForRelativePath(path.relative(rootReal, real));
  if (realDeny) return { ok: false, error: realDeny };

  try {
    const st = statSync(real);
    if (!st.isFile()) return { ok: false, error: "Not a regular file" };
  } catch {
    return { ok: false, error: "File not found" };
  }

  return { ok: true, abs: real };
}

export type ReadProjectFilePageResult = {
  page: number;
  totalPages: number;
  totalLines: number;
  sha256: string;
  content: string;
  path: string;
};

export function readProjectFilePage(input: {
  projectPath: string;
  path: string;
  page?: number;
}): ReadProjectFilePageResult | { error: string } {
  const rel = input.path.replace(/\\/g, "/").replace(/^\.\//, "");
  const safe = assertSafeProjectPath(input.projectPath, rel);
  if (!safe.ok) return { error: safe.error };

  const raw = readFileSync(safe.abs, "utf8");
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;
  const totalPages = Math.max(1, Math.ceil(totalLines / PAGE_LINES));
  const page = Math.min(
    totalPages,
    Math.max(1, Math.floor(input.page ?? 1)),
  );
  const start = (page - 1) * PAGE_LINES;
  const end = Math.min(totalLines, start + PAGE_LINES);
  const width = String(totalLines).length;
  const content = lines
    .slice(start, end)
    .map((line, i) => {
      const n = String(start + i + 1).padStart(width, " ");
      return `${n}| ${line}`;
    })
    .join("\n");

  return {
    path: rel,
    page,
    totalPages,
    totalLines,
    sha256,
    content,
  };
}

export function recordRead(input: {
  projectPath: string;
  chatId: string;
  messageId: string;
  modelId?: string;
  path: string;
  page: number;
  totalPages: number;
  sha256: string;
}): void {
  const rel = input.path.replace(/\\/g, "/").replace(/^\.\//, "");
  getNotebookDb(input.projectPath)
    .insert(readTracker)
    .values({
      id: nanoid(),
      chatId: input.chatId,
      messageId: input.messageId,
      modelId: input.modelId ?? null,
      path: rel,
      page: input.page,
      totalPages: input.totalPages,
      sha256: input.sha256,
      createdAt: Date.now(),
    })
    .run();
}

export type PathReadCompleteness = {
  pagesRead: number;
  totalPages: number;
  fullyRead: boolean;
};

export function getReadCompleteness(
  projectPath: string,
  chatId: string,
  messageId: string,
): Record<string, PathReadCompleteness> {
  const rows = getNotebookDb(projectPath)
    .select()
    .from(readTracker)
    .where(
      and(
        eq(readTracker.chatId, chatId),
        eq(readTracker.messageId, messageId),
      ),
    )
    .all();

  const byPath = new Map<
    string,
    { pages: Set<number>; totalPages: number }
  >();
  for (const r of rows) {
    let entry = byPath.get(r.path);
    if (!entry) {
      entry = { pages: new Set(), totalPages: r.totalPages };
      byPath.set(r.path, entry);
    }
    entry.pages.add(r.page);
    entry.totalPages = Math.max(entry.totalPages, r.totalPages);
  }

  const out: Record<string, PathReadCompleteness> = {};
  for (const [p, { pages, totalPages }] of byPath) {
    out[p] = {
      pagesRead: pages.size,
      totalPages,
      fullyRead: pages.size >= totalPages,
    };
  }
  return out;
}

/** Warn when the answer cites a path that was only partially read. */
export function noteIfPartialReads(
  answerText: string,
  completeness: Record<string, PathReadCompleteness>,
): string | null {
  const partial: string[] = [];
  for (const [p, c] of Object.entries(completeness)) {
    if (c.fullyRead) continue;
    const base = path.basename(p);
    if (
      answerText.includes(p) ||
      answerText.includes(base) ||
      answerText.includes(`\`${p}\``) ||
      answerText.includes(`\`${base}\``)
    ) {
      partial.push(`${p} (${c.pagesRead}/${c.totalPages} pages read)`);
    }
  }
  if (!partial.length) return null;
  return `Note: this reply references files that were not fully read: ${partial.join("; ")}.`;
}

/** Test helper */
export function clearReadTrackerForTests(projectPath: string): void {
  getNotebookDb(projectPath).delete(readTracker).run();
}
