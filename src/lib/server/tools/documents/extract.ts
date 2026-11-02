import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

export type ExtractedPage = { page: number; text: string };
export type ExtractedText = { text: string; pages?: ExtractedPage[] };

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".md",
  ".markdown",
  ".txt",
] as const;

export function documentExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

function resolveKind(absPath: string, mimeOrExt?: string): "pdf" | "text" {
  const hint = (mimeOrExt ?? "").toLowerCase();
  const ext = documentExtension(absPath);
  if (hint.includes("pdf") || hint === ".pdf" || ext === ".pdf") return "pdf";
  if (
    hint.includes("markdown") ||
    hint.startsWith("text/") ||
    [".md", ".markdown", ".txt"].includes(hint) ||
    [".md", ".markdown", ".txt"].includes(ext)
  ) {
    return "text";
  }
  throw new Error(
    `Unsupported document type: ${mimeOrExt || ext || "unknown"}`,
  );
}

/** Extract plain text from a PDF / markdown / text file. */
export async function extractTextFromFile(
  absPath: string,
  mimeOrExt?: string,
): Promise<ExtractedText> {
  const kind = resolveKind(absPath, mimeOrExt);
  const buf = await readFile(absPath);

  if (kind === "text") {
    return { text: buf.toString("utf8") };
  }

  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const result = await extractText(pdf, { mergePages: false });
  const pages = result.text.map((text, i) => ({
    page: i + 1,
    text: text.trim(),
  }));
  return { text: pages.map((p) => p.text).join("\n\n"), pages };
}
