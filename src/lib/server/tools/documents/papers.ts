import "server-only";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";

import { createRecord } from "@/lib/server/project/records";
import type { MemoryRecord } from "@/lib/server/project/types";

import { libraryDir } from "./store";

export const paperSchema = z.object({
  title: z.string().min(1).max(500),
  authors: z.array(z.string().max(200)).max(200).default([]),
  year: z.number().int().nullable().optional(),
  venue: z.string().max(500).nullable().optional(),
  abstract: z.string().max(100_000).nullable().optional(),
  doi: z.string().max(300).nullable().optional(),
  arxivId: z.string().max(100).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  pdfUrl: z.string().max(2000).nullable().optional(),
  citationCount: z.number().int().nullable().optional(),
  foundBy: z.array(z.string().max(50)).max(20).default([]),
});

export type SavedPaper = z.infer<typeof paperSchema>;

function paperBody(p: SavedPaper): string {
  const lines: string[] = [];
  if (p.authors.length) lines.push(`Authors: ${p.authors.join(", ")}`);
  const meta = [p.venue, p.year].filter(Boolean).join(" ");
  if (meta) lines.push(`Venue: ${meta}`);
  if (p.doi) lines.push(`DOI: ${p.doi}`);
  if (p.arxivId) lines.push(`arXiv: ${p.arxivId}`);
  if (p.url) lines.push(`URL: ${p.url}`);
  if (p.pdfUrl) lines.push(`PDF: ${p.pdfUrl}`);
  if (p.abstract) lines.push("", p.abstract);
  return lines.join("\n");
}

/** Save a paper (user action): `paper` record + `.research/library/papers/{id}.json`. */
export function savePaperToLibrary(
  projectPath: string,
  paper: SavedPaper,
): { record: MemoryRecord; id: string } {
  const id = nanoid();
  const dir = path.join(libraryDir(projectPath), "papers");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({ id, savedAt: Date.now(), ...paper }, null, 2),
    "utf8",
  );
  const record = createRecord(projectPath, {
    id,
    type: "paper",
    title: paper.title,
    body: paperBody(paper),
    source: "library",
    tags: paper.foundBy,
  });
  return { record, id };
}
