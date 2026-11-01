import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Detect a git repo at the project root, or a direct child (preferring `code/`).
 * Returns an absolute path to the repo root, or null.
 */
export function detectRepoPath(projectRoot: string): string | null {
  const root = path.resolve(projectRoot);
  if (existsSync(path.join(root, ".git"))) {
    return root;
  }

  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }

  if (entries.includes("code")) {
    const codePath = path.join(root, "code");
    try {
      if (
        statSync(codePath).isDirectory() &&
        existsSync(path.join(codePath, ".git"))
      ) {
        return codePath;
      }
    } catch {
      // continue
    }
  }

  for (const name of entries) {
    if (name === "code" || name === ".research" || name.startsWith(".")) {
      continue;
    }
    const child = path.join(root, name);
    try {
      if (
        statSync(child).isDirectory() &&
        existsSync(path.join(child, ".git"))
      ) {
        return child;
      }
    } catch {
      // skip
    }
  }

  return null;
}
