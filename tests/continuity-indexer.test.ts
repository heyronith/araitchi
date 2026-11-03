import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  chunkCode,
  chunkDocs,
  extractiveSummary,
} from "@/lib/server/continuity/chunking";
import {
  buildProjectIgnore,
  isIgnoredPath,
} from "@/lib/server/continuity/ignore";
import {
  indexProject,
  resetProjectIndexStateForTests,
  searchProjectFiles,
} from "@/lib/server/continuity/indexer";
import { FakeEmbedder } from "@/lib/server/memory/fake-embedder";
import { setEmbedderForTests } from "@/lib/server/memory/embedder";
import { setMemorySettings } from "@/lib/server/memory/settings";
import { closeAllNotebookDbs, getNotebookDb } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";
import { projectFileChunks } from "@/lib/server/project/schema";

afterEach(() => {
  setEmbedderForTests(null);
  resetProjectIndexStateForTests();
  closeAllNotebookDbs();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-idx-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "idx-test" });
  setMemorySettings(dir, { embeddingModel: "fake", scribeEnabled: false });
  setEmbedderForTests(new FakeEmbedder());
  return dir;
}

describe("chunking", () => {
  it("chunkCode respects top-level defs and line ranges", () => {
    const src = `/** module */\nexport function alpha() {\n  return 1;\n}\n\nexport function beta() {\n  return 2;\n}\n`;
    const chunks = chunkCode(src);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks.every((c) => c.endLine >= c.startLine)).toBe(true);
    expect(chunks.every((c) => c.endLine - c.startLine + 1 <= 80)).toBe(true);
  });

  it("chunkDocs splits on headings", () => {
    const md = "# Title\n\nIntro.\n\n## Section\n\nBody.";
    const chunks = chunkDocs(md);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.text).toContain("Title");
    expect(chunks[1]!.text).toContain("Section");
  });

  it("extractiveSummary picks heading or docstring", () => {
    const md = "# Goal\n\nFirst paragraph.";
    expect(extractiveSummary(md, "doc")).toContain("Goal");
    const py = '"""Module docs."""\ndef foo(): pass';
    expect(extractiveSummary(py, "code")).toContain("Module docs");
  });
});

describe("ignore rules", () => {
  it("honours .researchignore", () => {
    const p = tempProject();
    writeFileSync(path.join(p, ".researchignore"), "secret/\n");
    mkdirSync(path.join(p, "secret"));
    writeFileSync(path.join(p, "secret", "x.txt"), "hidden");
    writeFileSync(path.join(p, "visible.txt"), "ok");
    expect(isIgnoredPath(p, "secret/x.txt")).toBe(true);
    expect(isIgnoredPath(p, "visible.txt")).toBe(false);
    expect(buildProjectIgnore(p).ignores("secret/x.txt")).toBe(true);
  });
});

describe("indexProject", () => {
  it("skips re-index when sha256 unchanged", async () => {
    const p = tempProject();
    writeFileSync(path.join(p, "lib.ts"), "export const x = 1;\n");
    await indexProject(p);
    const chunksBefore = getNotebookDb(p)
      .select()
      .from(projectFileChunks)
      .all().length;
    await indexProject(p);
    const chunksAfter = getNotebookDb(p)
      .select()
      .from(projectFileChunks)
      .all().length;
    expect(chunksBefore).toBeGreaterThan(0);
    expect(chunksAfter).toBe(chunksBefore);
  });

  it("re-indexes when content changes", async () => {
    const p = tempProject();
    writeFileSync(path.join(p, "lib.ts"), "export const x = 1;\n");
    await indexProject(p);
    writeFileSync(path.join(p, "lib.ts"), "export const x = 2;\n");
    await indexProject(p);
    const { hits } = await searchProjectFiles({
      projectPath: p,
      query: "x = 2",
      kind: "code",
    });
    expect(hits.some((h) => h.text.includes("2"))).toBe(true);
  });
});
