import "server-only";

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

/** Root for the folder browser; override with ARAITCHI_FS_ROOT (tests). */
export function getFsRoot(): string {
  const override = process.env.ARAITCHI_FS_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(os.homedir());
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function isUnderRoot(candidate: string, root: string): boolean {
  const rootReal = safeRealpath(root) ?? path.resolve(root);
  const candReal = safeRealpath(candidate) ?? path.resolve(candidate);
  const rel = path.relative(rootReal, candReal);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a path that must stay under the FS root (home).
 * Rejects traversal and symlink escapes.
 * Accepts absolute paths only if they resolve under home.
 */
export function resolveUnderHome(inputPath: string): string {
  const root = getFsRoot();
  const rootReal = safeRealpath(root) ?? root;

  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(root, inputPath);

  if (!isUnderRoot(candidate, rootReal)) {
    throw new Error("Path is outside the allowed home directory");
  }

  const real = safeRealpath(candidate) ?? candidate;
  if (!isUnderRoot(real, rootReal)) {
    throw new Error("Path is outside the allowed home directory");
  }
  return real;
}

/** Absolute path open (paste-path): must exist and be a directory. */
export function assertExistingDirectory(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  if (!existsSync(resolved)) {
    throw new Error("Path does not exist");
  }
  const real = safeRealpath(resolved) ?? resolved;
  if (!statSync(/*turbopackIgnore: true*/ real).isDirectory()) {
    throw new Error("Path is not a directory");
  }
  return real;
}

export type DirEntry = {
  name: string;
  path: string;
};

export function listSubdirectories(dirPath: string): DirEntry[] {
  const dir = resolveUnderHome(dirPath === "" ? "." : dirPath);
  const entries = readdirSync(/*turbopackIgnore: true*/ dir);
  const out: DirEntry[] = [];
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    const full = path.join(/*turbopackIgnore: true*/ dir, name);
    try {
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        const real = safeRealpath(full);
        if (!real) continue;
        if (!isUnderRoot(real, getFsRoot())) continue;
        if (!statSync(/*turbopackIgnore: true*/ real).isDirectory()) continue;
      } else if (!st.isDirectory()) {
        continue;
      }
      out.push({ name, path: full });
    } catch {
      // skip unreadable
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function createSubdirectory(parentPath: string, name: string): string {
  const safeName = name.trim();
  if (
    !safeName ||
    safeName.includes("/") ||
    safeName.includes("\\") ||
    safeName === ".." ||
    safeName === "."
  ) {
    throw new Error("Invalid folder name");
  }
  const parent = resolveUnderHome(parentPath);
  const target = path.join(/*turbopackIgnore: true*/ parent, safeName);
  mkdirSync(target, { recursive: false });
  return target;
}

export function breadcrumbsFor(
  dirPath: string,
): { name: string; path: string }[] {
  const root = getFsRoot();
  const rootReal = safeRealpath(root) ?? root;
  const dir = resolveUnderHome(dirPath === "" ? "." : dirPath);
  const rel = path.relative(rootReal, dir);
  const parts = rel && rel !== "" ? rel.split(path.sep).filter(Boolean) : [];
  const crumbs = [
    { name: path.basename(rootReal) || rootReal, path: rootReal },
  ];
  let cur = rootReal;
  for (const part of parts) {
    cur = path.join(cur, part);
    crumbs.push({ name: part, path: cur });
  }
  return crumbs;
}
