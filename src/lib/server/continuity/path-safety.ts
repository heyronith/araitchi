import "server-only";

import { lstatSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";

/** True when `target` is `root` or a path beneath it (lexical). */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function realpathOrResolve(p: string): string {
  try {
    return realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/**
 * Reject zip-slip style entry names. Returns a normalised posix-relative path
 * (no leading `./`) that is safe to join under `destRoot`.
 */
export function assertSafeZipEntryName(
  entryName: string,
  destRoot: string,
): string {
  if (!entryName || entryName.includes("\0")) {
    throw new Error("Zip entry has an invalid name");
  }
  if (entryName.includes("\\")) {
    throw new Error("Zip entry must not contain backslashes");
  }
  if (/^[a-zA-Z]:/.test(entryName) || entryName.startsWith("//")) {
    throw new Error("Zip entry must not be an absolute or drive path");
  }
  if (path.isAbsolute(entryName) || entryName.startsWith("/")) {
    throw new Error("Zip entry must be relative");
  }

  const normalised = entryName.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalised) {
    throw new Error("Zip entry name is empty");
  }
  const segments = normalised.split("/");
  if (segments.some((s) => s === ".." || s === "")) {
    throw new Error("Zip entry path contains '..' or empty segments");
  }

  const dest = realpathOrResolve(destRoot);
  const target = path.resolve(dest, ...segments);
  if (!isInsideRoot(dest, target)) {
    throw new Error("Zip entry escapes destination directory");
  }
  return segments.join("/");
}

export function lstatOrNull(abs: string): Stats | null {
  try {
    return lstatSync(abs);
  } catch {
    return null;
  }
}

/**
 * Whether a path should be walked/indexed: skip symlinks; require the realpath
 * stay inside the project root. Detects revisit loops via inode keys.
 */
export function isSafeProjectFile(
  projectRoot: string,
  absPath: string,
  seenInodes?: Set<string>,
): boolean {
  const abs = path.resolve(absPath);
  const rootReal = realpathOrResolve(projectRoot);

  const st = lstatOrNull(abs);
  if (!st) return false;
  if (st.isSymbolicLink()) return false;

  if (seenInodes) {
    const key = `${st.dev}:${st.ino}`;
    if (seenInodes.has(key)) return false;
    seenInodes.add(key);
  }

  try {
    const real = realpathSync(abs);
    if (!isInsideRoot(rootReal, real)) return false;
  } catch {
    return false;
  }

  return st.isFile() || st.isDirectory();
}
