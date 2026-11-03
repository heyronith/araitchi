import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  exportResearchZip,
  importResearchZip,
} from "@/lib/server/continuity/backup";
import {
  applyMerge,
  archiveStaleQuestions,
  findDuplicateClusters,
  proposeMerges,
} from "@/lib/server/continuity/tidy";
import { FakeEmbedder } from "@/lib/server/memory/fake-embedder";
import { setEmbedderForTests } from "@/lib/server/memory/embedder";
import { indexRecord } from "@/lib/server/memory/index";
import { setMemorySettings } from "@/lib/server/memory/settings";
import {
  closeAllNotebookDbs,
  getNotebookSqlite,
} from "@/lib/server/project/db";
import { researchDir } from "@/lib/server/project/init";
import { ensureResearchStructure } from "@/lib/server/project/init";
import {
  createRecord,
  getRecord,
  listRecords,
} from "@/lib/server/project/records";

afterEach(() => {
  setEmbedderForTests(null);
  closeAllNotebookDbs();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-tidy-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "tidy-test" });
  setMemorySettings(dir, { embeddingModel: "fake", scribeEnabled: false });
  setEmbedderForTests(new FakeEmbedder());
  return dir;
}

describe("tidy memory", () => {
  it("finds duplicate clusters and merges without hard delete", async () => {
    const p = tempProject();
    const text = "Identical note about magnesium absorption rates in mice.";
    const a = createRecord(p, {
      type: "note",
      title: "Mg note",
      body: text,
      source: "user",
    });
    const b = createRecord(p, {
      type: "note",
      title: "Mg note",
      body: text,
      source: "user",
    });
    await indexRecord(p, a.id);
    await indexRecord(p, b.id);

    const clusters = await findDuplicateClusters(p, 0.92);
    expect(
      clusters.some((c) => c.ids.includes(a.id) && c.ids.includes(b.id)),
    ).toBe(true);

    const proposals = await proposeMerges(p, 0.92);
    expect(proposals.length).toBeGreaterThan(0);

    const result = await applyMerge(p, a.id, [b.id]);
    expect(result.ok).toBe(true);
    const kept = getRecord(p, a.id);
    expect(kept?.body).toContain("Merged from");
    const absorbed = getRecord(p, b.id);
    expect(absorbed?.deletedAt).not.toBeNull();
    expect(
      listRecords(p, { includeDeleted: true }).some((r) => r.id === b.id),
    ).toBe(true);
  });

  it("archives stale answered questions", () => {
    const p = tempProject();
    const old = Date.now() - 90 * 86_400_000;
    const q = createRecord(p, {
      type: "question",
      title: "Old Q",
      body: "Is X true?",
      status: "answered",
      source: "user",
    });
    const sqlite = getNotebookSqlite(p);
    sqlite
      .prepare("UPDATE records SET updated_at = ?, created_at = ? WHERE id = ?")
      .run(old, old, q.id);

    const { archived, ids } = archiveStaleQuestions(p, 60);
    expect(archived).toBe(1);
    expect(ids).toContain(q.id);
    expect(getRecord(p, q.id)?.status).toBe("archived");
    expect(listRecords(p, { query: "X true" }).some((r) => r.id === q.id)).toBe(
      true,
    );
  });
});

describe("research backup", () => {
  it("exports and imports .research without wal/shm or backup zips", async () => {
    const p = tempProject();
    const research = researchDir(p);
    writeFileSync(path.join(research, "brief.md"), "# brief\n", "utf8");
    writeFileSync(path.join(research, "notebook.db-wal"), "wal", "utf8");
    mkdirSync(path.join(research, "cache"), { recursive: true });
    writeFileSync(path.join(research, "cache", "model.onnx"), "bin", "utf8");

    const { zipPath, fileCount } = await exportResearchZip(p);
    expect(fileCount).toBeGreaterThan(0);

    const dest = mkdtempSync(path.join(tmpdir(), "araitchi-import-"));
    ensureResearchStructure(dest, { name: "import-test" });
    const imported = await importResearchZip(dest, zipPath, {
      skipPreBackup: true,
      confirmNotebookReplace: true,
    });
    expect(imported.status).toBe("ok");
    if (imported.status !== "ok") throw new Error("expected ok");
    expect(imported.extracted).toBeGreaterThan(0);

    const destResearch = researchDir(dest);
    expect(readFileSync(path.join(destResearch, "brief.md"), "utf8")).toContain(
      "# brief",
    );
    expect(existsSync(path.join(destResearch, "notebook.db-wal"))).toBe(false);
    expect(existsSync(path.join(destResearch, "cache", "model.onnx"))).toBe(
      false,
    );

    rmSync(dest, { recursive: true, force: true });
  });
});
