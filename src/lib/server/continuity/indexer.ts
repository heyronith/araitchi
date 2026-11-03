import "server-only";

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";
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
import {
  embeddings,
  projectFileChunks,
  projectFiles,
} from "@/lib/server/project/schema";

import { recordActivity } from "./activity";
import {
  chunkCode,
  chunkDocs,
  extractiveSummary,
  type TextChunk,
} from "./chunking";
import {
  buildProjectIgnore,
  classifyFileKind,
  fileTooLarge,
  isBinaryish,
  isIgnoredPath,
  languageForPath,
  MAX_INDEX_FILES,
  MAX_INDEX_TEXT_BYTES,
} from "./ignore";

export type ProjectIndexProgress = {
  filesDone: number;
  filesTotal: number;
  bytesText: number;
  exceededLimits: boolean;
  phase: "idle" | "scanning" | "indexing" | "done";
};

const progressByRoot = new Map<string, ProjectIndexProgress>();
const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function getIndexProgress(
  projectPath: string,
): ProjectIndexProgress | null {
  return progressByRoot.get(path.resolve(projectPath)) ?? null;
}

function setProgress(root: string, p: ProjectIndexProgress) {
  progressByRoot.set(root, p);
}

function fileSha256(abs: string): string {
  const buf = readFileSync(abs);
  return createHash("sha256").update(buf).digest("hex");
}

function relPosix(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

function collectFiles(projectPath: string): string[] {
  const root = path.resolve(projectPath);
  const ig = buildProjectIgnore(root);
  const out: string[] = [];

  function walk(dir: string) {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = relPosix(root, abs);
      if (isIgnoredPath(root, rel, ig)) continue;
      if (ent.isDirectory()) {
        walk(abs);
      } else if (ent.isFile()) {
        out.push(rel);
      }
    }
  }
  walk(root);
  out.sort();
  return out;
}

function chunksForFile(
  text: string,
  kind: ReturnType<typeof classifyFileKind>,
): TextChunk[] {
  if (kind === "code") return chunkCode(text);
  if (kind === "doc") return chunkDocs(text);
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  return [
    {
      startLine: 1,
      endLine: lines.length,
      text,
    },
  ];
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
        eq(embeddings.ownerType, "project_chunk"),
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
        ownerType: "project_chunk",
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

function deleteFileIndex(projectPath: string, fileId: string): void {
  const db = getNotebookDb(projectPath);
  const chunkRows = db
    .select({ id: projectFileChunks.id })
    .from(projectFileChunks)
    .where(eq(projectFileChunks.fileId, fileId))
    .all();
  const chunkIds = chunkRows.map((r) => r.id);
  if (chunkIds.length) {
    db.delete(embeddings)
      .where(
        and(
          eq(embeddings.ownerType, "project_chunk"),
          inArray(embeddings.ownerId, chunkIds),
        ),
      )
      .run();
  }
  db.delete(projectFiles).where(eq(projectFiles.id, fileId)).run();
}

async function indexOneFile(
  projectPath: string,
  rel: string,
  opts: { embed: boolean },
): Promise<{ indexed: boolean; bytes: number }> {
  const root = path.resolve(projectPath);
  const abs = path.join(root, rel);
  const kind = classifyFileKind(rel);
  const db = getNotebookDb(projectPath);

  let st;
  try {
    st = statSync(abs);
  } catch {
    const existing = db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.path, rel))
      .get();
    if (existing) deleteFileIndex(projectPath, existing.id);
    return { indexed: false, bytes: 0 };
  }

  if (!st.isFile()) return { indexed: false, bytes: 0 };
  if (isBinaryish(rel) || fileTooLarge(abs)) {
    const sha = fileSha256(abs);
    const existing = db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.path, rel))
      .get();
    if (existing?.sha256 === sha) return { indexed: false, bytes: 0 };
    if (existing) deleteFileIndex(projectPath, existing.id);
    const id = nanoid();
    const now = Date.now();
    db.insert(projectFiles)
      .values({
        id,
        path: rel,
        kind,
        language: languageForPath(rel),
        size: st.size,
        mtime: Math.floor(st.mtimeMs),
        sha256: sha,
        summary: "",
        updatedAt: now,
      })
      .run();
    return { indexed: true, bytes: 0 };
  }

  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return { indexed: false, bytes: 0 };
  }

  const sha = createHash("sha256").update(text).digest("hex");
  const existing = db
    .select()
    .from(projectFiles)
    .where(eq(projectFiles.path, rel))
    .get();
  if (existing?.sha256 === sha) return { indexed: false, bytes: 0 };

  if (existing) deleteFileIndex(projectPath, existing.id);

  const fileId = nanoid();
  const now = Date.now();
  const summary = extractiveSummary(text, kind);
  db.insert(projectFiles)
    .values({
      id: fileId,
      path: rel,
      kind,
      language: languageForPath(rel),
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      sha256: sha,
      summary,
      updatedAt: now,
    })
    .run();

  const chunks = chunksForFile(text, kind);
  const chunkTexts = chunks.map((c) => c.text);
  let vectors: Float32Array[] = [];
  let model = "fake";
  if (opts.embed && chunkTexts.length) {
    try {
      const settings = getMemorySettings(projectPath);
      const embedder = await getEmbedder(settings.embeddingModel);
      model = embedder.modelId;
      vectors = await embedder.embed(chunkTexts, { isQuery: false });
    } catch {
      vectors = [];
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    const chunkId = nanoid();
    db.insert(projectFileChunks)
      .values({
        id: chunkId,
        fileId,
        chunkIdx: i,
        startLine: c.startLine,
        endLine: c.endLine,
        text: c.text,
        updatedAt: now,
      })
      .run();
    if (vectors[i]) {
      await upsertChunkEmbedding({
        projectPath,
        chunkId,
        chunkIdx: 0,
        text: c.text,
        model,
        vector: vectors[i]!,
      });
    }
  }

  return { indexed: true, bytes: Buffer.byteLength(text, "utf8") };
}

export type IndexProjectOptions = {
  embed?: boolean;
  paths?: string[];
};

export async function indexProject(
  projectPath: string,
  opts?: IndexProjectOptions,
): Promise<ProjectIndexProgress> {
  const root = path.resolve(projectPath);
  const embed = opts?.embed !== false;
  const paths =
    opts?.paths?.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "")) ??
    collectFiles(projectPath);

  let exceededLimits = false;
  let bytesText = 0;
  const capped = paths.slice(0, MAX_INDEX_FILES);
  if (paths.length > MAX_INDEX_FILES) exceededLimits = true;

  setProgress(root, {
    filesDone: 0,
    filesTotal: capped.length,
    bytesText: 0,
    exceededLimits,
    phase: "indexing",
  });

  let done = 0;
  for (const rel of capped) {
    if (bytesText >= MAX_INDEX_TEXT_BYTES) {
      exceededLimits = true;
      break;
    }
    const r = await indexOneFile(projectPath, rel, { embed });
    if (r.indexed) {
      bytesText += r.bytes;
      if (bytesText > MAX_INDEX_TEXT_BYTES) exceededLimits = true;
    }
    done++;
    setProgress(root, {
      filesDone: done,
      filesTotal: capped.length,
      bytesText,
      exceededLimits,
      phase: done >= capped.length ? "done" : "indexing",
    });
  }

  const final = getIndexProgress(root)!;
  recordActivity(projectPath, {
    kind: "index",
    summary: `Indexed ${final.filesDone}/${final.filesTotal} project files`,
    payload: { bytesText, exceededLimits },
  });
  return final;
}

export type ProjectTreeNode =
  | { type: "dir"; name: string; path: string; children?: ProjectTreeNode[] }
  | { type: "file"; name: string; path: string; kind: string };

export function projectTree(input: {
  projectPath: string;
  path?: string;
  depth?: number;
}): ProjectTreeNode {
  const root = path.resolve(input.projectPath);
  const maxDepth = Math.min(4, Math.max(0, input.depth ?? 2));
  const sub = (input.path ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  const base = sub ? path.join(root, sub) : root;
  const ig = buildProjectIgnore(root);

  function node(abs: string, rel: string, depth: number): ProjectTreeNode {
    const name = path.basename(abs) || rel || ".";
    let st;
    try {
      st = statSync(abs);
    } catch {
      return { type: "file", name, path: rel, kind: "other" };
    }
    if (!st.isDirectory()) {
      return {
        type: "file",
        name,
        path: rel,
        kind: classifyFileKind(rel),
      };
    }
    if (depth >= maxDepth) {
      return { type: "dir", name, path: rel || "." };
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return { type: "dir", name, path: rel || "." };
    }
    const children: ProjectTreeNode[] = [];
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childAbs = path.join(abs, ent.name);
      const childRel = relPosix(root, childAbs);
      if (isIgnoredPath(root, childRel, ig)) continue;
      if (ent.isDirectory()) {
        children.push(node(childAbs, childRel, depth + 1));
      } else if (ent.isFile()) {
        children.push({
          type: "file",
          name: ent.name,
          path: childRel,
          kind: classifyFileKind(childRel),
        });
      }
    }
    return { type: "dir", name, path: rel || ".", children };
  }

  return node(base, sub, 0);
}

export type ProjectFileSearchHit = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  text: string;
  kind: string;
};

function ftsProjectHits(
  projectPath: string,
  query: string,
  limit: number,
  kind?: "code" | "docs" | "data" | "all",
): { id: string; score: number; text: string }[] {
  const sqlite = getNotebookSqlite(projectPath);
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (!terms.length) return [];
  const match = terms.join(" OR ");
  const kindFilter =
    kind && kind !== "all"
      ? kind === "docs"
        ? "AND pf.kind = 'doc'"
        : kind === "code"
          ? "AND pf.kind = 'code'"
          : kind === "data"
            ? "AND pf.kind = 'data'"
            : ""
      : "";
  try {
    const rows = sqlite
      .prepare(
        `SELECT c.id AS id, bm25(project_file_chunks_fts) AS score, c.text AS text
         FROM project_file_chunks_fts f
         JOIN project_file_chunks c ON c.rowid = f.rowid
         JOIN project_files pf ON pf.id = c.file_id
         WHERE project_file_chunks_fts MATCH ?
         ${kindFilter}
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

export async function searchProjectFiles(input: {
  projectPath: string;
  query: string;
  kind?: "code" | "docs" | "data" | "all";
  limit?: number;
}): Promise<{ hits: ProjectFileSearchHit[]; vectorUsed: boolean }> {
  const limit = Math.min(20, Math.max(1, input.limit ?? 10));
  const q = input.query.trim();
  if (!q) return { hits: [], vectorUsed: false };

  const kind = input.kind ?? "all";
  const fts = ftsProjectHits(input.projectPath, q, limit * 3, kind);
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
          eq(embeddings.ownerType, "project_chunk"),
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
  const hits: ProjectFileSearchHit[] = [];

  for (const { id, score } of fused) {
    const chunk = db
      .select()
      .from(projectFileChunks)
      .where(eq(projectFileChunks.id, id))
      .get();
    if (!chunk) continue;
    const file = db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.id, chunk.fileId))
      .get();
    if (!file) continue;
    if (kind === "code" && file.kind !== "code") continue;
    if (kind === "docs" && file.kind !== "doc") continue;
    if (kind === "data" && file.kind !== "data") continue;

    hits.push({
      path: file.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score,
      text: ftsMap.get(id)?.text ?? chunk.text,
      kind: file.kind,
    });
    if (hits.length >= limit) break;
  }

  return { hits, vectorUsed };
}

const pendingByRoot = new Map<string, Set<string>>();

function scheduleIncremental(root: string, rel: string) {
  let set = pendingByRoot.get(root);
  if (!set) {
    set = new Set();
    pendingByRoot.set(root, set);
  }
  set.add(rel);
  const prev = debounceTimers.get(root);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    root,
    setTimeout(() => {
      debounceTimers.delete(root);
      const paths = [...(pendingByRoot.get(root) ?? [])];
      pendingByRoot.delete(root);
      if (paths.length) {
        void indexProject(root, { paths }).catch(() => undefined);
      }
    }, 500),
  );
}

export function startProjectWatcher(projectPath: string): void {
  const root = path.resolve(projectPath);
  if (watchers.has(root)) return;
  const ig = buildProjectIgnore(root);
  const watcher = chokidar.watch(root, {
    ignored: (abs) => {
      const rel = relPosix(root, abs);
      if (!rel) return false;
      return isIgnoredPath(root, rel, ig);
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  watcher.on("add", (p) => scheduleIncremental(root, relPosix(root, p)));
  watcher.on("change", (p) => scheduleIncremental(root, relPosix(root, p)));
  watcher.on("unlink", (p) => {
    const rel = relPosix(root, p);
    const db = getNotebookDb(root);
    const row = db
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.path, rel))
      .get();
    if (row) deleteFileIndex(root, row.id);
  });
  watchers.set(root, watcher);
}

export async function stopProjectWatcher(projectPath: string): Promise<void> {
  const root = path.resolve(projectPath);
  const w = watchers.get(root);
  if (w) {
    await w.close();
    watchers.delete(root);
  }
  const t = debounceTimers.get(root);
  if (t) clearTimeout(t);
  debounceTimers.delete(root);
  pendingByRoot.delete(root);
}

/** Test helper — reset in-memory progress and watchers. */
export function resetProjectIndexStateForTests(): void {
  progressByRoot.clear();
  for (const w of watchers.values()) void w.close();
  watchers.clear();
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
  pendingByRoot.clear();
}

/** Test helper — clear indexed files for a project. */
export function clearProjectIndexForTests(projectPath: string): void {
  const sqlite = getNotebookSqlite(projectPath);
  sqlite.exec("DELETE FROM embeddings WHERE owner_type = 'project_chunk'");
  sqlite.exec("DELETE FROM project_file_chunks");
  sqlite.exec("DELETE FROM project_files");
}
