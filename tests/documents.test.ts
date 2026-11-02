import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scoreChunks } from "@/lib/server/tools/documents/chunk";
import { extractTextFromFile } from "@/lib/server/tools/documents/extract";
import { savePaperToLibrary } from "@/lib/server/tools/documents/papers";
import {
  listLibraryDocuments,
  saveLibraryDocument,
} from "@/lib/server/tools/documents/store";
import { createDocumentTools } from "@/lib/server/tools/documents/tools";
import { listRecords } from "@/lib/server/project/records";
import { ensureResearchStructure } from "@/lib/server/project/init";

const FIXTURE = path.join(process.cwd(), "tests/fixtures/documents/hello.pdf");

async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "araitchi-doc-"));
  ensureResearchStructure(dir);
  return dir;
}

const ctx = (projectPath: string) => ({
  projectPath,
  chatId: "c",
  messageId: "m",
  modelId: "x",
});

describe("chunk scoring", () => {
  it("ranks relevant chunks and keeps page numbers", () => {
    const pages = [
      { page: 1, text: "Introduction to cooking pasta and sauces." },
      {
        page: 2,
        text: "Graph neural networks for molecules. Graph networks excel.",
      },
      { page: 3, text: "Unrelated appendix about weather." },
    ];
    const top = scoreChunks(pages, "graph neural networks", { topK: 2 });
    expect(top[0]?.page).toBe(2);
    expect(top.every((c) => c.score > 0)).toBe(true);
  });

  it("works on plain text and returns nothing for no overlap", () => {
    const text = "alpha beta gamma\n\ndelta epsilon zeta";
    expect(scoreChunks(text, "epsilon")[0]?.text).toContain("epsilon");
    expect(scoreChunks(text, "qqqq")).toEqual([]);
  });
});

describe("extract", () => {
  it("extracts text from txt/md files", async () => {
    const dir = await project();
    const f = path.join(dir, "n.md");
    writeFileSync(f, "# Title\n\nbody");
    const res = await extractTextFromFile(f, ".md");
    expect(res.text).toContain("body");
    expect(res.pages).toBeUndefined();
  });

  it("extracts text from the fixture PDF via unpdf", async () => {
    const res = await extractTextFromFile(FIXTURE, "application/pdf");
    expect(res.pages?.length).toBe(1);
    expect(res.pages?.[0]?.page).toBe(1);
    expect(res.text).toContain("Hello Araitchi");
  });
});

describe("library store + read_document", () => {
  it("saves a PDF, lists it, and read_document returns a page-numbered chunk", async () => {
    const dir = await project();
    const doc = await saveLibraryDocument({
      projectPath: dir,
      filename: "hello.pdf",
      buffer: readFileSync(FIXTURE),
      id: "doc1",
    });
    expect(doc.pageCount).toBe(1);
    expect(
      readFileSync(path.join(dir, ".research/library/doc1/original.pdf"))
        .length,
    ).toBeGreaterThan(0);
    expect(listLibraryDocuments(dir).map((d) => d.id)).toEqual(["doc1"]);

    const [tool] = createDocumentTools();
    const res = await tool!.handler({ id: "doc1", query: "hello" }, ctx(dir));
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { chunks: { page: number; text: string }[] };
      expect(data.chunks[0]?.page).toBe(1);
      expect(data.chunks[0]?.text).toContain("Hello Araitchi");
    }

    const pages = await tool!.handler({ id: "doc1", pages: "1" }, ctx(dir));
    expect(pages.ok && JSON.stringify(pages.data)).toContain("page 1");
  });

  it("rejects unsupported types, bad ids and unknown documents", async () => {
    const dir = await project();
    await expect(
      saveLibraryDocument({
        projectPath: dir,
        filename: "x.exe",
        buffer: Buffer.from("x"),
      }),
    ).rejects.toThrow(/Unsupported/);
    await expect(
      saveLibraryDocument({
        projectPath: dir,
        filename: "x.txt",
        buffer: Buffer.from("x"),
        id: "../evil",
      }),
    ).rejects.toThrow(/Invalid document id/);
    const [tool] = createDocumentTools();
    const res = await tool!.handler({ id: "nope" }, ctx(dir));
    expect(res.ok).toBe(false);
    const traversal = await tool!.handler({ id: "../x" }, ctx(dir));
    expect(traversal.ok).toBe(false);
  });

  it("txt documents work without pages", async () => {
    const dir = await project();
    await saveLibraryDocument({
      projectPath: dir,
      filename: "notes.txt",
      buffer: Buffer.from("Transformers use attention.\n\nBananas are yellow."),
      id: "t1",
    });
    const [tool] = createDocumentTools();
    const res = await tool!.handler({ id: "t1", query: "attention" }, ctx(dir));
    expect(res.ok && JSON.stringify(res.data)).toContain("attention");
  });
});

describe("papers", () => {
  it("saves a paper record and metadata json", async () => {
    const dir = await project();
    mkdirSync(path.join(dir, ".research/library"), { recursive: true });
    const { id, record } = savePaperToLibrary(dir, {
      title: "Attention Is All You Need",
      authors: ["Vaswani"],
      year: 2017,
      doi: "10.5555/3295222.3295349",
      foundBy: ["openalex"],
    });
    expect(record.type).toBe("paper");
    expect(
      JSON.parse(
        readFileSync(
          path.join(dir, `.research/library/papers/${id}.json`),
          "utf8",
        ),
      ).title,
    ).toBe("Attention Is All You Need");
    expect(listRecords(dir, { type: "paper" })).toHaveLength(1);
    expect(listLibraryDocuments(dir)).toEqual([]);
  });
});
