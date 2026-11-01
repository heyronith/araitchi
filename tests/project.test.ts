import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { getAppDb } from "@/lib/server/db/client";
import {
  assertExistingDirectory,
  listSubdirectories,
  resolveUnderHome,
} from "@/lib/server/fs-browser";
import { getAppDataDir } from "@/lib/server/paths";
import {
  createChat,
  insertMessage,
  listChats,
  persistSessionTranscript,
} from "@/lib/server/project/chats";
import {
  approxTokens,
  buildProjectSystemContext,
  truncateToTokens,
} from "@/lib/server/project/context";
import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { detectRepoPath } from "@/lib/server/project/detect-repo";
import { exportMemoryMd } from "@/lib/server/project/exporters";
import {
  ensureResearchStructure,
  readBrief,
  researchDir,
  writeBrief,
} from "@/lib/server/project/init";
import {
  acquireProjectLock,
  releaseProjectLock,
} from "@/lib/server/project/lock";
import { migrateChatsFromAppDbIfNeeded } from "@/lib/server/project/migrate-from-app";
import {
  createRecord,
  listRecords,
  restoreRecord,
  softDeleteRecord,
  updateRecord,
} from "@/lib/server/project/records";
import {
  getCurrentProjectId,
  openProject,
  releaseActiveProjectLock,
} from "@/lib/server/project/registry";
import {
  ensureScratchExists,
  getScratchProjectPath,
} from "@/lib/server/project/scratch";
import { setSetting } from "@/lib/server/settings";

afterEach(() => {
  releaseActiveProjectLock();
  closeAllNotebookDbs();
});

describe("project init", () => {
  it("is idempotent and creates the full .research structure", () => {
    const root = path.join(getAppDataDir(), "proj-a");
    mkdirSync(root, { recursive: true });
    const a = ensureResearchStructure(root, { name: "Proj A" });
    const b = ensureResearchStructure(root);
    expect(a.id).toBe(b.id);
    const research = researchDir(root);
    expect(existsSync(path.join(research, "project.json"))).toBe(true);
    expect(existsSync(path.join(research, "brief.md"))).toBe(true);
    expect(existsSync(path.join(research, "memory.md"))).toBe(true);
    expect(existsSync(path.join(research, "library"))).toBe(true);
    expect(existsSync(path.join(research, "sessions"))).toBe(true);
    expect(existsSync(path.join(research, ".gitignore"))).toBe(true);
    openProject(root);
    expect(existsSync(path.join(research, "notebook.db"))).toBe(true);
  });
});

describe("repo detection", () => {
  it("detects root .git, code/.git, and none", () => {
    const base = path.join(getAppDataDir(), "repos");
    const withRoot = path.join(base, "root-git");
    mkdirSync(path.join(withRoot, ".git"), { recursive: true });
    expect(detectRepoPath(withRoot)).toBe(path.resolve(withRoot));

    const withCode = path.join(base, "code-git");
    mkdirSync(path.join(withCode, "code", ".git"), { recursive: true });
    expect(detectRepoPath(withCode)).toBe(path.resolve(withCode, "code"));

    const none = path.join(base, "none");
    mkdirSync(none, { recursive: true });
    expect(detectRepoPath(none)).toBeNull();
  });

  it("handles Windows-style path inputs via path.resolve", () => {
    const root = path.join(getAppDataDir(), "winish");
    mkdirSync(path.join(root, ".git"), { recursive: true });
    const mixed = root.split(path.sep).join("/");
    expect(detectRepoPath(mixed)).toBe(path.resolve(root));
  });
});

describe("fs browser", () => {
  it("rejects paths outside home, traversal, and symlink escapes", () => {
    const home = process.env.ARAITCHI_FS_ROOT!;
    const inside = path.join(home, "inside");
    mkdirSync(inside, { recursive: true });

    expect(() => resolveUnderHome(path.join(home, "..", "outside"))).toThrow(
      /outside/,
    );
    expect(() => resolveUnderHome("/tmp/definitely-outside-araitchi")).toThrow(
      /outside/,
    );

    const entries = listSubdirectories(home);
    expect(entries.some((e) => e.name === "inside")).toBe(true);

    // Symlink escape (skip if OS can't create symlinks)
    const escapeTarget = path.join(getAppDataDir(), "escape-target");
    mkdirSync(escapeTarget, { recursive: true });
    // Put escape target outside FS root by using parent of home when possible
    const outside = path.resolve(home, "..", "symlink-escape-target");
    try {
      mkdirSync(outside, { recursive: true });
      const link = path.join(home, "bad-link");
      symlinkSync(outside, link);
      expect(() => resolveUnderHome(link)).toThrow(/outside/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EPERM") {
        // Windows without symlink privilege
        return;
      }
      if (e instanceof Error && /outside/.test(e.message)) {
        // expected throw from resolveUnderHome — success
        return;
      }
      throw e;
    }

    expect(() => assertExistingDirectory(inside)).not.toThrow();
  });
});

describe("records + FTS + memory.md", () => {
  it("supports CRUD, FTS search, soft delete, and export", () => {
    const root = path.join(getAppDataDir(), "mem-proj");
    mkdirSync(root, { recursive: true });
    openProject(root);

    const r = createRecord(root, {
      type: "hypothesis",
      title: "Gravity is curved spacetime",
      body: "Einstein field equations predict lensing.",
      status: "testing",
      pinned: true,
      source: "user",
      tags: ["physics"],
    });
    expect(r.pinned).toBe(true);

    const found = listRecords(root, { query: "lensing" });
    expect(found.some((x) => x.id === r.id)).toBe(true);

    updateRecord(root, r.id, { status: "supported" });
    softDeleteRecord(root, r.id);
    expect(listRecords(root).find((x) => x.id === r.id)).toBeUndefined();
    restoreRecord(root, r.id);
    expect(listRecords(root).find((x) => x.id === r.id)).toBeTruthy();

    const md = exportMemoryMd(root);
    expect(md).toContain("Gravity is curved spacetime");
    expect(md).toContain("status: supported");
    const onDisk = readFileSync(
      path.join(researchDir(root), "memory.md"),
      "utf8",
    );
    expect(onDisk).toContain("Gravity is curved spacetime");
  });
});

describe("session transcript", () => {
  it("writes a markdown file under sessions/", () => {
    const root = path.join(getAppDataDir(), "sess-proj");
    mkdirSync(root, { recursive: true });
    openProject(root);
    const chat = createChat(root, "Session test");
    insertMessage(root, {
      chatId: chat.id,
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    });
    const asst = insertMessage(root, {
      chatId: chat.id,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "Hi there" }],
      modelId: "openai/gpt-4o-mini",
    });
    // fix parent
    void asst;
    persistSessionTranscript(root, chat.id);
    const sessions = path.join(researchDir(root), "sessions");
    const files = readdirSync(sessions);
    expect(files.some((f) => f.endsWith(".md"))).toBe(true);
  });
});

describe("brief + pinned context caps", () => {
  it("respects approximate token caps", () => {
    expect(approxTokens("abcd")).toBe(1);
    const truncated = truncateToTokens("x".repeat(100), 5);
    expect(approxTokens(truncated)).toBeLessThanOrEqual(6);

    const root = path.join(getAppDataDir(), "ctx-proj");
    mkdirSync(root, { recursive: true });
    openProject(root);
    writeBrief(root, "UNIQUE_BRIEF_MARKER " + "word ".repeat(100));
    createRecord(root, {
      type: "note",
      title: "Pinned note",
      body: "one line body",
      pinned: true,
      source: "user",
    });
    const ctx = buildProjectSystemContext(root);
    expect(ctx.systemText).toContain("UNIQUE_BRIEF_MARKER");
    expect(ctx.pinnedCount).toBe(1);
    expect(ctx.briefTokens).toBeLessThanOrEqual(2000);
    expect(readBrief(root)).toContain("UNIQUE_BRIEF_MARKER");
  });
});

describe("scratch migration", () => {
  it("moves chats into Scratch exactly once", () => {
    // Seed legacy tables before drop (simulate pre-migration DB).
    getAppDb();
    const sqlitePath = path.join(getAppDataDir(), "app.db");
    const raw = new Database(sqlitePath);
    raw.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id text PRIMARY KEY NOT NULL,
        title text NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id text PRIMARY KEY NOT NULL,
        chat_id text NOT NULL,
        parent_id text,
        role text NOT NULL,
        parts text NOT NULL,
        model_id text,
        usage text,
        created_at integer NOT NULL
      );
    `);
    raw
      .prepare(
        `INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      )
      .run("legacy-chat", "Legacy", 1, 2);
    raw
      .prepare(
        `INSERT INTO messages (id, chat_id, parent_id, role, parts, model_id, usage, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy-msg",
        "legacy-chat",
        null,
        "user",
        JSON.stringify([{ type: "text", text: "hi" }]),
        null,
        null,
        1,
      );
    raw.close();

    // Clear flag so migration runs again for this test DB
    setSetting("migrated_chats_to_scratch_v1", false);

    const first = migrateChatsFromAppDbIfNeeded();
    expect(first.migrated).toBe(true);
    expect(first.chatCount).toBe(1);

    const scratch = getScratchProjectPath();
    ensureScratchExists();
    const chats = listChats(scratch);
    expect(chats.some((c) => c.id === "legacy-chat")).toBe(true);

    const second = migrateChatsFromAppDbIfNeeded();
    expect(second.migrated).toBe(false);
  });
});

describe("lock behaviour", () => {
  it("opens read-only when another live PID holds the lock", () => {
    const root = path.join(getAppDataDir(), "lock-proj");
    mkdirSync(root, { recursive: true });
    const research = researchDir(root);
    ensureResearchStructure(root);
    // Fake another live process: use current pid then change file to a
    // different alive-looking pid — on most systems PID 1 is alive.
    writeFileSync(
      path.join(research, ".lock"),
      JSON.stringify({ pid: 1, timestamp: Date.now() }),
    );
    const result = acquireProjectLock(research);
    expect(result.readOnly).toBe(true);
    expect(result.warning).toMatch(/read-only/i);
    releaseProjectLock(research);
  });
});

describe("scratch default", () => {
  it("bootstraps Scratch as current project", () => {
    getAppDb();
    expect(getCurrentProjectId()).toBeTruthy();
    expect(existsSync(path.join(getScratchProjectPath(), ".research"))).toBe(
      true,
    );
  });
});
