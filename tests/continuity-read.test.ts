import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeProjectPath,
  getReadCompleteness,
  noteIfPartialReads,
  PAGE_LINES,
  readProjectFilePage,
  recordRead,
  clearReadTrackerForTests,
} from "@/lib/server/continuity/read-file";
import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";

afterEach(() => {
  closeAllNotebookDbs();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-read-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "read-test" });
  return dir;
}

describe("readProjectFilePage", () => {
  it("pages long files with line numbers", () => {
    const p = tempProject();
    const lines = Array.from(
      { length: PAGE_LINES + 5 },
      (_, i) => `line ${i + 1}`,
    );
    writeFileSync(path.join(p, "big.txt"), lines.join("\n"));
    const page1 = readProjectFilePage({
      projectPath: p,
      path: "big.txt",
      page: 1,
    });
    expect("error" in page1).toBe(false);
    if ("error" in page1) return;
    expect(page1.totalPages).toBe(2);
    expect(page1.totalLines).toBe(PAGE_LINES + 5);
    expect(page1.content).toContain("| line 1");
    expect(page1.content).toContain(`| line ${PAGE_LINES}`);

    const page2 = readProjectFilePage({
      projectPath: p,
      path: "big.txt",
      page: 2,
    });
    if ("error" in page2) throw new Error(page2.error);
    expect(page2.page).toBe(2);
    expect(page2.content).toContain(`| line ${PAGE_LINES + 1}`);
  });
});

describe("assertSafeProjectPath", () => {
  it("denies traversal and secrets", () => {
    const base = mkdtempSync(path.join(tmpdir(), "araitchi-read-guard-"));
    const p = path.join(base, "proj");
    const outside = path.join(base, "outside");
    mkdirSync(p);
    mkdirSync(outside);
    ensureResearchStructure(p, { name: "guard" });
    writeFileSync(path.join(outside, "secret.txt"), "nope");
    writeFileSync(path.join(p, "ok.txt"), "yes");
    writeFileSync(path.join(p, ".env"), "KEY=1");

    expect(assertSafeProjectPath(p, "../outside/secret.txt").ok).toBe(false);
    expect(assertSafeProjectPath(p, ".env").ok).toBe(false);
    expect(assertSafeProjectPath(p, "ok.txt").ok).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });

  it("denies symlinks that escape the project", () => {
    const base = mkdtempSync(path.join(tmpdir(), "araitchi-read-link-"));
    const p = path.join(base, "proj");
    const outside = path.join(base, "outside");
    mkdirSync(p);
    mkdirSync(outside);
    ensureResearchStructure(p, { name: "link" });
    writeFileSync(path.join(outside, "secret.txt"), "nope");
    try {
      symlinkSync(path.join(outside, "secret.txt"), path.join(p, "link.txt"));
      expect(assertSafeProjectPath(p, "link.txt").ok).toBe(false);
    } catch {
      // symlinks unavailable
    }
    rmSync(base, { recursive: true, force: true });
  });
});

describe("read completeness", () => {
  it("tracks pages and partial-read notes", () => {
    const p = tempProject();
    writeFileSync(path.join(p, "a.txt"), "one\n");
    recordRead({
      projectPath: p,
      chatId: "c1",
      messageId: "m1",
      path: "a.txt",
      page: 1,
      totalPages: 2,
      sha256: "abc",
    });
    const comp = getReadCompleteness(p, "c1", "m1");
    expect(comp["a.txt"]?.fullyRead).toBe(false);
    expect(comp["a.txt"]?.pagesRead).toBe(1);
    const note = noteIfPartialReads("See a.txt for details.", comp);
    expect(note).toContain("not fully read");
    clearReadTrackerForTests(p);
  });
});
