import "server-only";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

import {
  documentExtension,
  extractTextFromFile,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  type ExtractedPage,
} from "./extract";

export const MAX_LIBRARY_UPLOAD_BYTES = 50 * 1024 * 1024;
const RESERVED_IDS = new Set(["papers"]);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type LibraryDocument = {
  id: string;
  filename: string;
  ext: string;
  size: number;
  pageCount: number | null;
  charCount: number;
  createdAt: number;
};

export type ExtractedDocument = LibraryDocument & {
  text: string;
  pages?: ExtractedPage[];
};

export function libraryDir(projectPath: string): string {
  return path.join(path.resolve(projectPath), ".research", "library");
}

export function isValidDocumentId(id: string): boolean {
  return ID_RE.test(id) && !RESERVED_IDS.has(id);
}

function documentDir(projectPath: string, id: string): string {
  return path.join(libraryDir(projectPath), id);
}

export async function saveLibraryDocument(input: {
  projectPath: string;
  filename: string;
  buffer: Buffer;
  id?: string;
}): Promise<LibraryDocument> {
  const ext = documentExtension(input.filename);
  if (!(SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error("Unsupported file type. Use PDF, Markdown or text files.");
  }
  if (input.buffer.length > MAX_LIBRARY_UPLOAD_BYTES) {
    throw new Error("File exceeds the 50 MB limit");
  }
  const id = input.id ?? nanoid();
  if (!isValidDocumentId(id)) throw new Error("Invalid document id");

  const dir = documentDir(input.projectPath, id);
  const originalPath = path.join(dir, `original${ext}`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(originalPath, input.buffer);
    const extracted = await extractTextFromFile(originalPath, ext);
    const doc: ExtractedDocument = {
      id,
      filename: path.basename(input.filename),
      ext,
      size: input.buffer.length,
      pageCount: extracted.pages ? extracted.pages.length : null,
      charCount: extracted.text.length,
      createdAt: Date.now(),
      text: extracted.text,
      pages: extracted.pages,
    };
    await writeFile(
      path.join(dir, "extracted.json"),
      JSON.stringify(doc),
      "utf8",
    );
    const { text: _text, pages: _pages, ...meta } = doc;
    void _text;
    void _pages;
    return meta;
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

export function readLibraryDocument(
  projectPath: string,
  id: string,
): ExtractedDocument | null {
  if (!isValidDocumentId(id)) return null;
  const file = path.join(documentDir(projectPath, id), "extracted.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ExtractedDocument;
  } catch {
    return null;
  }
}

export function listLibraryDocuments(projectPath: string): LibraryDocument[] {
  const dir = libraryDir(projectPath);
  if (!existsSync(dir)) return [];
  const docs: LibraryDocument[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidDocumentId(entry.name)) continue;
    const doc = readLibraryDocument(projectPath, entry.name);
    if (!doc) continue;
    const { text: _text, pages: _pages, ...meta } = doc;
    void _text;
    void _pages;
    docs.push(meta);
  }
  docs.sort((a, b) => b.createdAt - a.createdAt);
  return docs;
}
