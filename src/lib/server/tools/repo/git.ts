import "server-only";

import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;

export type ExecGitResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string; exitCode?: number };

/**
 * Run `git` with an argument array (never a shell string) in `repoPath`.
 * Never throws; failures are returned as `{ ok: false, error }`.
 */
export function execGit(
  repoPath: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<ExecGitResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        "git",
        args,
        {
          cwd: repoPath,
          timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" },
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ ok: true, stdout: String(stdout) });
            return;
          }
          const err = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: string | null;
          };
          if (err.code === "ENOENT") {
            resolve({
              ok: false,
              error:
                "git is not installed or not on PATH. Install git to use repo tools.",
            });
            return;
          }
          if (err.killed || err.signal === "SIGTERM") {
            resolve({ ok: false, error: "git command timed out" });
            return;
          }
          if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            resolve({ ok: false, error: "git output too large" });
            return;
          }
          const detail = String(stderr || "").trim() || err.message;
          resolve({
            ok: false,
            error: `git failed: ${detail}`,
            exitCode: typeof err.code === "number" ? err.code : undefined,
          });
        },
      );
    } catch (e) {
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : "git execution failed",
      });
    }
  });
}
