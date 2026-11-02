import "server-only";

import { z } from "zod";

import type { RegisteredTool } from "../types";
import { scoreChunks } from "./chunk";
import { readLibraryDocument } from "./store";

const MAX_OUTPUT_CHARS = 12_000;

/** Parse "1-3,5" or [1,2] into a sorted unique list of page numbers. */
export function parsePageSelection(
  pages: string | number[],
  maxPage: number,
): number[] {
  const out = new Set<number>();
  if (Array.isArray(pages)) {
    for (const p of pages) if (p >= 1 && p <= maxPage) out.add(p);
  } else {
    for (const part of pages.split(",")) {
      const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
      if (!m) continue;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      for (let p = Math.max(1, a); p <= Math.min(b, maxPage); p++) out.add(p);
    }
  }
  return [...out].sort((a, b) => a - b);
}

const schema = z.object({
  id: z.string().min(1).max(64),
  query: z.string().min(1).max(500).optional(),
  pages: z
    .union([z.string().max(100), z.array(z.number().int().min(1)).max(100)])
    .optional(),
});

function cap(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]`
    : text;
}

export function createDocumentTools(): RegisteredTool[] {
  const read_document: RegisteredTool = {
    name: "read_document",
    description:
      "Read an uploaded library document (PDF, Markdown, text) by id. With `query`, returns the most relevant chunks with page numbers; with `pages` (e.g. '1-3,5') returns those pages; otherwise the beginning of the document.",
    inputSchema: schema,
    kind: "read",
    provider: "documents",
    ttlSec: 0,
    handler: async (args: z.infer<typeof schema>, ctx) => {
      const doc = readLibraryDocument(ctx.projectPath, args.id);
      if (!doc) return { ok: false, error: `Document not found: ${args.id}` };

      const header = {
        id: doc.id,
        filename: doc.filename,
        pageCount: doc.pageCount,
      };

      if (args.pages !== undefined && doc.pages) {
        const wanted = parsePageSelection(args.pages, doc.pages.length);
        if (!wanted.length) {
          return {
            ok: false,
            error: `No valid pages (document has ${doc.pages.length})`,
          };
        }
        const parts = doc.pages
          .filter((p) => wanted.includes(p.page))
          .map((p) => `[page ${p.page}]\n${p.text}`);
        const text = cap(parts.join("\n\n"));
        return {
          ok: true,
          data: { ...header, pages: wanted, text },
          modelText: text,
        };
      }

      if (args.query) {
        const chunks = scoreChunks(doc.pages ?? doc.text, args.query, {
          topK: 5,
        });
        if (!chunks.length) {
          return {
            ok: true,
            data: {
              ...header,
              chunks: [],
              text: "No relevant passages found.",
            },
            modelText: "No relevant passages found.",
          };
        }
        const text = cap(
          chunks
            .map(
              (c, i) =>
                `[${i + 1}]${c.page ? ` (page ${c.page})` : ""}\n${c.text}`,
            )
            .join("\n\n"),
        );
        return {
          ok: true,
          data: { ...header, chunks, text },
          modelText: text,
        };
      }

      const text = cap(doc.text);
      return { ok: true, data: { ...header, text }, modelText: text };
    },
  };
  return [read_document];
}
