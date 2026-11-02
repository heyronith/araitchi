import "server-only";

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { detectRepoPath as detectRepoPathInTree } from "@/lib/server/project/detect-repo";
import {
  getProjectSetting,
  setProjectSetting,
} from "@/lib/server/project/settings";

import type { RegisteredTool, ToolResult } from "../types";
import { execGit } from "./git";
import { assertSafeRepoPath } from "./paths";

export const NO_REPO_ERROR = "No git repository detected for this project";
const MAX_DIFF_CHARS = 100_000;
const MAX_TEXT_CHARS = 100_000;
const MAX_FIND_RESULTS = 200;

export const REPO_LAST_CHECK_KEY = "repo.last_check";
export const REPO_PATH_KEY = "repo.path";

/** Pathspecs hiding secret-like files from git diff / grep / ls-files. */
const SECRET_EXCLUDES = [
  ":(exclude,glob)**/.env",
  ":(exclude,glob)**/.env.*",
  ":(exclude,glob)**/.env_*",
  ":(exclude,glob)**/.env-*",
  ":(exclude,glob)**/*.pem",
  ":(exclude,glob)**/*.key",
  ":(exclude,glob)**/id_*",
];

export type RepoToolContext = {
  projectPath: string;
  repoPath: string | null;
};

function isGitDir(dir: string): boolean {
  return existsSync(path.join(dir, ".git"));
}

/**
 * Locate the git repo for a project: stored `repo.path` setting, then the
 * project root / its children, then the parent directory.
 */
export function detectRepoPath(projectPath: string): string | null {
  const root = path.resolve(projectPath);

  try {
    const stored = getProjectSetting<string | null>(root, REPO_PATH_KEY, null);
    if (stored && statSync(stored).isDirectory() && isGitDir(stored)) {
      return stored;
    }
  } catch {
    // fall through to detection
  }

  const found = detectRepoPathInTree(root);
  if (found) return found;

  const parent = path.dirname(root);
  if (parent !== root && isGitDir(parent)) return parent;
  return null;
}

/** Record the repo's current HEAD as `repo.last_check` for the project. */
export async function markRepoChecked(
  projectPath: string,
): Promise<{ ok: true; head: string } | { ok: false; error: string }> {
  const repoPath = detectRepoPath(projectPath);
  if (!repoPath) return { ok: false, error: NO_REPO_ERROR };
  const res = await execGit(repoPath, ["rev-parse", "HEAD"]);
  if (!res.ok) return res;
  const head = res.stdout.trim();
  setProjectSetting(projectPath, REPO_LAST_CHECK_KEY, head);
  return { ok: true, head };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated]`;
}

function textResult(text: string, extra?: Record<string, unknown>): ToolResult {
  return { ok: true, data: { text, ...extra }, modelText: text };
}

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/~^@{}:-]*$/;

function glob(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "i");
}

export function createRepoTools(ctx: RepoToolContext): RegisteredTool[] {
  const { projectPath, repoPath } = ctx;

  function guarded(
    run: (repo: string) => Promise<ToolResult>,
  ): () => Promise<ToolResult> {
    return async () => {
      if (!repoPath) return { ok: false, error: NO_REPO_ERROR };
      try {
        return await run(repoPath);
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Repo tool failed",
        };
      }
    };
  }

  const repo_status: RegisteredTool = {
    name: "repo_status",
    description:
      "Show the current branch and working-tree status of the project's git repository (git status --porcelain -b).",
    inputSchema: z.object({}),
    kind: "read",
    provider: "repo",
    ttlSec: 0,
    handler: guarded(async (repo) => {
      const res = await execGit(repo, ["status", "--porcelain", "-b"]);
      if (!res.ok) return res;
      return textResult(
        truncate(res.stdout.trim() || "(clean)", MAX_TEXT_CHARS),
      );
    }),
  };

  const logSchema = z.object({
    n: z.number().int().min(1).max(50).optional(),
    since: z.string().min(1).max(200).optional(),
  });
  const repo_log: RegisteredTool = {
    name: "repo_log",
    description:
      "List recent commits (hash, author, date, subject). `n` up to 50; optional `since` date (e.g. '2 weeks ago').",
    inputSchema: logSchema,
    kind: "read",
    provider: "repo",
    ttlSec: 0,
    handler: async (args: z.infer<typeof logSchema>) =>
      guarded(async (repo) => {
        const n = Math.min(Math.max(args.n ?? 20, 1), 50);
        const gitArgs = [
          "log",
          `-n${n}`,
          "--no-color",
          "--date=iso-strict",
          "--format=%H%x09%an%x09%ad%x09%s",
        ];
        if (args.since) gitArgs.push(`--since=${args.since}`);
        const res = await execGit(repo, gitArgs);
        if (!res.ok) return res;
        const commits = res.stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash, author, date, ...subject] = line.split("\t");
            return { hash, author, date, subject: subject.join("\t") };
          });
        const text =
          commits
            .map(
              (c) =>
                `${c.hash?.slice(0, 10)} ${c.date} ${c.author}: ${c.subject}`,
            )
            .join("\n") || "(no commits)";
        return textResult(text, { commits });
      })(),
  };

  const diffSchema = z.object({ since: z.string().min(1).max(200) });
  const repo_diff: RegisteredTool = {
    name: "repo_diff",
    description:
      'Show the diff from a git ref (or "last_check" for the last user-marked check) to the current working tree. Output is truncated at 100k characters.',
    inputSchema: diffSchema,
    kind: "read",
    provider: "repo",
    ttlSec: 0,
    handler: async (args: z.infer<typeof diffSchema>) =>
      guarded(async (repo) => {
        let ref = args.since.trim();
        if (ref === "last_check") {
          const stored = getProjectSetting<string | null>(
            projectPath,
            REPO_LAST_CHECK_KEY,
            null,
          );
          if (!stored) {
            return {
              ok: false,
              error:
                "No last_check recorded for this project; pass a git ref instead",
            };
          }
          ref = stored;
        }
        if (!SAFE_REF.test(ref)) return { ok: false, error: "Invalid git ref" };
        const res = await execGit(repo, [
          "diff",
          "--no-color",
          "--no-ext-diff",
          ref,
          "--",
          ".",
          ...SECRET_EXCLUDES,
        ]);
        if (!res.ok) return res;
        return textResult(
          truncate(res.stdout.trim() || "(no changes)", MAX_DIFF_CHARS),
          { ref },
        );
      })(),
  };

  const readSchema = z.object({
    path: z.string().min(1).max(1000),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  });
  const repo_read_file: RegisteredTool = {
    name: "repo_read_file",
    description:
      "Read a text file from the repository by relative path, optionally a line range (1-based, inclusive). Secrets, .git internals and files over 1 MB are denied.",
    inputSchema: readSchema,
    kind: "read",
    provider: "repo",
    ttlSec: 0,
    handler: async (args: z.infer<typeof readSchema>) =>
      guarded(async (repo) => {
        const safe = assertSafeRepoPath(repo, args.path);
        if (!safe.ok) return safe;
        const buf = readFileSync(safe.abs);
        if (buf.subarray(0, 8000).includes(0)) {
          return { ok: false, error: "Binary file; cannot read as text" };
        }
        const lines = buf.toString("utf8").split("\n");
        const start = args.startLine ?? 1;
        const end = Math.min(args.endLine ?? lines.length, lines.length);
        if (start > end) return { ok: false, error: "Invalid line range" };
        const slice = lines.slice(start - 1, end).join("\n");
        return textResult(truncate(slice, MAX_TEXT_CHARS), {
          path: args.path,
          startLine: start,
          endLine: end,
          totalLines: lines.length,
        });
      })(),
  };

  const findSchema = z.object({ pattern: z.string().min(1).max(500) });
  const repo_find: RegisteredTool = {
    name: "repo_find",
    description:
      "Find tracked files by glob (e.g. 'src/**/*.ts') or substring of the path (git ls-files).",
    inputSchema: findSchema,
    kind: "read",
    provider: "repo",
    ttlSec: 0,
    handler: async (args: z.infer<typeof findSchema>) =>
      guarded(async (repo) => {
        const res = await execGit(repo, [
          "ls-files",
          "--",
          ".",
          ...SECRET_EXCLUDES,
        ]);
        if (!res.ok) return res;
        const files = res.stdout.split("\n").filter(Boolean);
        const hasWildcard = /[*?]/.test(args.pattern);
        let matcher: (f: string) => boolean;
        if (hasWildcard) {
          const re = glob(args.pattern);
          const reBase = glob(
            args.pattern.includes("/") ? args.pattern : `**/${args.pattern}`,
          );
          matcher = (f) => re.test(f) || reBase.test(f);
        } else {
          const needle = args.pattern.toLowerCase();
          matcher = (f) => f.toLowerCase().includes(needle);
        }
        const matches = files.filter(matcher);
        const shown = matches.slice(0, MAX_FIND_RESULTS);
        const text =
          (shown.join("\n") || "(no matches)") +
          (matches.length > shown.length ? "\n[truncated]" : "");
        return textResult(text, { files: shown, total: matches.length });
      })(),
  };

  const grepSchema = z.object({
    pattern: z.string().min(1).max(500),
    maxResults: z.number().int().min(1).max(100).optional(),
  });
  const repo_grep: RegisteredTool = {
    name: "repo_grep",
    description:
      "Search tracked files with an extended regex (git grep -n). `maxResults` up to 100.",
    inputSchema: grepSchema,
    kind: "read",
    provider: "repo",
    ttlSec: 0,
    handler: async (args: z.infer<typeof grepSchema>) =>
      guarded(async (repo) => {
        const max = Math.min(Math.max(args.maxResults ?? 50, 1), 100);
        const res = await execGit(repo, [
          "grep",
          "-n",
          "-I",
          "-E",
          "--no-color",
          "-e",
          args.pattern,
          "--",
          ".",
          ...SECRET_EXCLUDES,
        ]);
        if (!res.ok) {
          if (res.exitCode === 1) {
            return textResult("(no matches)", { matches: [], total: 0 });
          }
          return res;
        }
        const all = res.stdout.split("\n").filter(Boolean);
        const matches = all.slice(0, max).map((l) => truncate(l, 500));
        const text =
          matches.join("\n") +
          (all.length > matches.length ? "\n[truncated]" : "");
        return textResult(text, { matches, total: all.length });
      })(),
  };

  return [
    repo_status,
    repo_log,
    repo_diff,
    repo_read_file,
    repo_find,
    repo_grep,
  ];
}
