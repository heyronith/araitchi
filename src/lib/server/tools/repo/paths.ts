import "server-only";

import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_REPO_FILE_BYTES = 1024 * 1024;

type PathResult = { ok: true; abs: string } | { ok: false; error: string };

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Returns a denial reason for a repo-relative path, or null if allowed. */
export function denyReasonForRelativePath(rel: string): string | null {
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  if (segments.some((s) => s.toLowerCase() === ".git")) {
    return "Access to .git internals is denied";
  }
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (
      lower === ".env" ||
      lower.startsWith(".env.") ||
      lower.startsWith(".env_") ||
      lower.startsWith(".env-")
    ) {
      return "Access to .env files is denied";
    }
    if (lower.endsWith(".pem") || lower.endsWith(".key")) {
      return "Access to key files is denied";
    }
    if (lower.startsWith("id_")) {
      return "Access to SSH key files is denied";
    }
  }
  return null;
}

/**
 * Synchronous (realpathSync) safe-path check. Resolves symlinks, requires the
 * target to stay inside the repo's realpath, applies a denylist, and caps size.
 */
export function assertSafeRepoPath(
  repoRoot: string,
  relativePath: string,
  opts?: { maxBytes?: number },
): PathResult {
  if (!relativePath || relativePath.includes("\0")) {
    return { ok: false, error: "Invalid path" };
  }
  if (path.isAbsolute(relativePath)) {
    return { ok: false, error: "Path must be relative to the repository" };
  }

  let rootReal: string;
  try {
    rootReal = realpathSync(repoRoot);
  } catch {
    return { ok: false, error: "Repository root not found" };
  }

  const lexical = path.resolve(rootReal, relativePath);
  if (!isInside(rootReal, lexical)) {
    return { ok: false, error: "Path escapes the repository" };
  }
  const lexicalDeny = denyReasonForRelativePath(
    path.relative(rootReal, lexical),
  );
  if (lexicalDeny) return { ok: false, error: lexicalDeny };

  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    return { ok: false, error: "File not found" };
  }
  if (!isInside(rootReal, real)) {
    return { ok: false, error: "Path escapes the repository" };
  }
  const realDeny = denyReasonForRelativePath(path.relative(rootReal, real));
  if (realDeny) return { ok: false, error: realDeny };

  const maxBytes = opts?.maxBytes ?? MAX_REPO_FILE_BYTES;
  try {
    const st = statSync(real);
    if (!st.isFile()) return { ok: false, error: "Not a regular file" };
    if (st.size > maxBytes) {
      return {
        ok: false,
        error: `File is larger than ${maxBytes} bytes`,
      };
    }
  } catch {
    return { ok: false, error: "File not found" };
  }

  return { ok: true, abs: real };
}
