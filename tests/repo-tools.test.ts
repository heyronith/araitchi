import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import * as childProcess from "node:child_process";

import { ensureResearchStructure } from "@/lib/server/project/init";
import { execGit } from "@/lib/server/tools/repo/git";
import { assertSafeRepoPath } from "@/lib/server/tools/repo/paths";
import {
  createRepoTools,
  detectRepoPath,
  markRepoChecked,
} from "@/lib/server/tools/repo/tools";
import type { ToolHandlerContext } from "@/lib/server/tools/types";

function gitInstalled(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasGit = gitInstalled();
const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

let repo: string;
let outside: string;
let base: string;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), "araitchi-repo-"));
  repo = path.join(base, "repo");
  outside = path.join(base, "outside");
  mkdirSync(repo);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "secret.txt"), "top secret");
  writeFileSync(path.join(repo, "a.txt"), "line1\nline2\nline3\n");
  writeFileSync(path.join(repo, ".env"), "KEY=1");
  writeFileSync(path.join(repo, ".env.local"), "KEY=2");
  writeFileSync(path.join(repo, "server.pem"), "pem");
  writeFileSync(path.join(repo, "id_rsa"), "rsa");
  writeFileSync(path.join(repo, "big.txt"), Buffer.alloc(1024 * 1024 + 1, 97));
  mkdirSync(path.join(repo, "sub"));
  writeFileSync(path.join(repo, "sub", "b.ts"), "export const needle = 1;\n");
  try {
    symlinkSync(path.join(outside, "secret.txt"), path.join(repo, "link.txt"));
  } catch {
    // symlinks may be unavailable (Windows)
  }
  if (hasGit) {
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "Tester"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["add", "a.txt", "sub/b.ts"]);
    git(repo, ["commit", "-q", "-m", "first commit"]);
  }
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("assertSafeRepoPath", () => {
  it("allows normal files", () => {
    const res = assertSafeRepoPath(repo, "a.txt");
    expect(res.ok).toBe(true);
  });

  it("denies path traversal", () => {
    expect(assertSafeRepoPath(repo, "../outside/secret.txt").ok).toBe(false);
    expect(assertSafeRepoPath(repo, "sub/../../outside/secret.txt").ok).toBe(
      false,
    );
    expect(assertSafeRepoPath(repo, path.join(outside, "secret.txt")).ok).toBe(
      false,
    );
  });

  it("denies symlinks that escape the repo", () => {
    const res = assertSafeRepoPath(repo, "link.txt");
    expect(res.ok).toBe(false);
  });

  it("denies .env, keys, ssh keys, .git and big files", () => {
    for (const p of [
      ".env",
      ".env.local",
      "server.pem",
      "id_rsa",
      ".git/config",
      "big.txt",
    ]) {
      expect(assertSafeRepoPath(repo, p).ok, p).toBe(false);
    }
  });
});

describe.skipIf(!hasGit)("git tools", () => {
  it("execGit passes argument arrays to execFile (no shell)", async () => {
    const spy = vi.mocked(childProcess.execFile);
    spy.mockClear();
    const res = await execGit(repo, ["log", "-n1", "--format=%s; echo pwned"]);
    expect(res.ok).toBe(true);
    expect(res.ok && res.stdout.trim()).toBe("first commit; echo pwned");
    expect(spy).toHaveBeenCalledTimes(1);
    const [file, args, options] = spy.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; shell?: unknown },
    ];
    expect(file).toBe("git");
    expect(Array.isArray(args)).toBe(true);
    expect(options.cwd).toBe(repo);
    expect(options.shell).toBeFalsy();
  });

  it("tools call git with argument arrays", async () => {
    const spy = vi.mocked(childProcess.execFile);
    spy.mockClear();
    const tools = createRepoTools({ projectPath: base, repoPath: repo });
    const find = (n: string) => tools.find((t) => t.name === n)!;
    await find("repo_grep").handler({ pattern: "needle; rm -rf /" }, ctx());
    for (const call of spy.mock.calls) {
      expect(call[0]).toBe("git");
      expect(Array.isArray(call[1])).toBe(true);
    }
    expect(spy.mock.calls.length).toBeGreaterThan(0);
  });

  it("repo_log returns the commit; status/find/grep/read work", async () => {
    const tools = createRepoTools({ projectPath: base, repoPath: repo });
    const run = (n: string, args: unknown) =>
      tools.find((t) => t.name === n)!.handler(args, ctx());

    const log = await run("repo_log", { n: 5 });
    expect(log.ok).toBe(true);
    if (log.ok) {
      expect(JSON.stringify(log.data)).toContain("first commit");
    }

    const status = await run("repo_status", {});
    expect(status.ok).toBe(true);
    if (status.ok) expect(JSON.stringify(status.data)).toContain("##");

    const find = await run("repo_find", { pattern: "**/*.ts" });
    expect(find.ok && JSON.stringify(find.data)).toContain("sub/b.ts");

    const grep = await run("repo_grep", { pattern: "needle" });
    expect(grep.ok && JSON.stringify(grep.data)).toContain("sub/b.ts:1:");

    const none = await run("repo_grep", { pattern: "zzzznotthere" });
    expect(none.ok).toBe(true);

    const read = await run("repo_read_file", {
      path: "a.txt",
      startLine: 2,
      endLine: 3,
    });
    expect(read.ok && (read.data as { text: string }).text).toBe(
      "line2\nline3",
    );

    const env = await run("repo_read_file", { path: ".env" });
    expect(env.ok).toBe(false);
  });

  it("repo_diff supports last_check", async () => {
    const tools = createRepoTools({ projectPath: base, repoPath: repo });
    const diff = tools.find((t) => t.name === "repo_diff")!;
    writeFileSync(path.join(repo, "a.txt"), "line1\nCHANGED\nline3\n");
    const res = await diff.handler({ since: "HEAD" }, ctx());
    expect(res.ok && JSON.stringify(res.data)).toContain("CHANGED");
    const bad = await diff.handler({ since: "--output=/tmp/x" }, ctx());
    expect(bad.ok).toBe(false);
    git(repo, ["checkout", "--", "a.txt"]);
  });

  it("markRepoChecked stores HEAD and repo_diff last_check uses it", async () => {
    const project = mkdtempSync(path.join(base, "proj-"));
    git(project, ["init", "-q"]);
    git(project, ["config", "user.email", "t@example.com"]);
    git(project, ["config", "user.name", "Tester"]);
    git(project, ["config", "commit.gpgsign", "false"]);
    writeFileSync(path.join(project, "f.txt"), "one\n");
    git(project, ["add", "f.txt"]);
    git(project, ["commit", "-q", "-m", "c1"]);

    ensureResearchStructure(project);
    expect(detectRepoPath(project)).toBe(project);
    const marked = await markRepoChecked(project);
    expect(marked.ok).toBe(true);

    writeFileSync(path.join(project, "f.txt"), "one\ntwo-added\n");
    git(project, ["commit", "-qam", "c2"]);

    const tools = createRepoTools({ projectPath: project, repoPath: project });
    const diff = tools.find((t) => t.name === "repo_diff")!;
    const res = await diff.handler(
      { since: "last_check" },
      {
        ...ctx(),
        projectPath: project,
      },
    );
    expect(res.ok && JSON.stringify(res.data)).toContain("two-added");
  });
});

describe("no repo", () => {
  it("all tools return ok:false when repoPath is null", async () => {
    const tools = createRepoTools({ projectPath: base, repoPath: null });
    expect(tools.map((t) => t.name).sort()).toEqual([
      "repo_diff",
      "repo_find",
      "repo_grep",
      "repo_log",
      "repo_read_file",
      "repo_status",
    ]);
    const args: Record<string, unknown> = {
      repo_diff: { since: "HEAD" },
      repo_find: { pattern: "x" },
      repo_grep: { pattern: "x" },
      repo_log: {},
      repo_read_file: { path: "a.txt" },
      repo_status: {},
    };
    for (const t of tools) {
      expect(t.kind).toBe("read");
      expect(t.provider).toBe("repo");
      expect(t.ttlSec).toBe(0);
      const res = await t.handler(args[t.name], ctx());
      expect(res).toEqual({
        ok: false,
        error: "No git repository detected for this project",
      });
    }
  });
});

function ctx(): ToolHandlerContext {
  return { projectPath: base, chatId: "c", messageId: "m", modelId: "x" };
}
