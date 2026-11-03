import "server-only";

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ignore, { type Ignore } from "ignore";

import { denyReasonForRelativePath } from "@/lib/server/tools/repo/paths";

import { researchDir } from "@/lib/server/project/init";

export const MAX_INDEX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_INDEX_FILES = 20_000;
export const MAX_INDEX_TEXT_BYTES = 200 * 1024 * 1024;

const DEFAULT_IGNORES = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  "out/",
  "coverage/",
  ".turbo/",
  ".cache/",
  "**/*.pyc",
  "**/__pycache__/",
  ".venv/",
  "venv/",
  "*.min.js",
  "*.map",
  "*.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  ".research/notebook.db",
  ".research/notebook.db-*",
  ".research/cache/",
  ".research/backups/",
  ".research/.lock",
];

function loadIgnoreFile(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function buildProjectIgnore(projectPath: string): Ignore {
  const root = path.resolve(projectPath);
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);
  ig.add(loadIgnoreFile(path.join(root, ".gitignore")));
  ig.add(loadIgnoreFile(path.join(researchDir(root), "..", ".researchignore")));
  // also allow .researchignore at project root
  ig.add(loadIgnoreFile(path.join(root, ".researchignore")));
  return ig;
}

export function isIgnoredPath(
  projectPath: string,
  relativePath: string,
  ig?: Ignore,
): boolean {
  const rel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel) return false;
  if (denyReasonForRelativePath(rel)) return true;
  const checker = ig ?? buildProjectIgnore(projectPath);
  return checker.ignores(rel);
}

export function classifyFileKind(
  relativePath: string,
): "code" | "doc" | "data" | "image" | "other" {
  const ext = path.extname(relativePath).toLowerCase();
  if (
    [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".rs",
      ".go",
      ".java",
      ".kt",
      ".swift",
      ".c",
      ".h",
      ".cpp",
      ".hpp",
      ".cs",
      ".rb",
      ".php",
      ".scala",
      ".r",
      ".sql",
      ".sh",
      ".bash",
      ".zsh",
    ].includes(ext)
  ) {
    return "code";
  }
  if ([".md", ".mdx", ".txt", ".rst", ".adoc", ".tex", ".org"].includes(ext)) {
    return "doc";
  }
  if (
    [
      ".csv",
      ".tsv",
      ".json",
      ".jsonl",
      ".parquet",
      ".arrow",
      ".xlsx",
      ".yml",
      ".yaml",
      ".toml",
      ".xml",
    ].includes(ext)
  ) {
    return "data";
  }
  if (
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext)
  ) {
    return "image";
  }
  return "other";
}

export function languageForPath(relativePath: string): string | null {
  const ext = path.extname(relativePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".md": "markdown",
    ".json": "json",
    ".sql": "sql",
  };
  return map[ext] ?? null;
}

export function isBinaryish(relativePath: string): boolean {
  const kind = classifyFileKind(relativePath);
  if (kind === "image") return true;
  const ext = path.extname(relativePath).toLowerCase();
  return [
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".ico",
    ".bin",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".onnx",
    ".pt",
    ".pth",
    ".safetensors",
  ].includes(ext);
}

export function fileTooLarge(absPath: string): boolean {
  try {
    return statSync(absPath).size > MAX_INDEX_FILE_BYTES;
  } catch {
    return true;
  }
}
