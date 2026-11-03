import "server-only";

import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import JSZip from "jszip";

import { researchDir } from "@/lib/server/project/init";

import { assertSafeZipEntryName, isSafeProjectFile } from "./path-safety";

const MODEL_EXT = new Set([
  ".onnx",
  ".bin",
  ".safetensors",
  ".pt",
  ".pth",
  ".gguf",
]);

/** Max files/dirs listed in a research backup zip. */
export const MAX_ZIP_ENTRIES = 10_000;
/** Max total uncompressed bytes extracted from a research backup. */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

function relPosix(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

function shouldExcludeResearchRel(rel: string): boolean {
  if (!rel) return false;
  if (rel === "notebook.db-wal" || rel === "notebook.db-shm") return true;
  if (rel === ".lock" || rel.endsWith("/.lock")) return true;
  if (rel.startsWith("cache/") || rel === "cache") return true;
  if (rel.startsWith("backups/") && rel.endsWith(".zip")) return true;
  const base = path.posix.basename(rel);
  const ext = path.posix.extname(base).toLowerCase();
  if (MODEL_EXT.has(ext)) return true;
  if (rel.includes("/models/") || rel.startsWith("models/")) return true;
  return false;
}

function collectFiles(researchRoot: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  function walk(dir: string) {
    // Mark directory once at entry — callers must not pre-check with the same set.
    if (!isSafeProjectFile(researchRoot, dir, seen)) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(dir, name);
      const st = (() => {
        try {
          return lstatSync(abs);
        } catch {
          return null;
        }
      })();
      if (!st || st.isSymbolicLink()) continue;
      const rel = relPosix(researchRoot, abs);
      if (shouldExcludeResearchRel(rel)) continue;
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile() && isSafeProjectFile(researchRoot, abs, seen)) {
        out.push(rel);
      }
    }
  }
  walk(researchRoot);
  return out.sort();
}

function timestampLabel(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export type ExportResearchResult = {
  zipPath: string;
  fileCount: number;
  bytes: number;
};

/**
 * Export `.research/` to a timestamped zip under `.research/backups/`.
 * Excludes WAL/SHM, lock files, cache/, model weights, and existing backup zips.
 * Skips symlinks.
 */
export async function exportResearchZip(
  projectPath: string,
): Promise<ExportResearchResult> {
  const research = researchDir(projectPath);
  const backups = path.join(research, "backups");
  mkdirSync(backups, { recursive: true });

  const zip = new JSZip();
  const files = collectFiles(research);
  let bytes = 0;

  for (const rel of files) {
    const abs = path.join(research, rel);
    const data = readFileSync(abs);
    bytes += data.length;
    zip.file(rel, data);
  }

  const outName = `research-${timestampLabel()}.zip`;
  const zipPath = path.join(backups, outName);
  const content = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  writeFileSync(zipPath, content);

  return { zipPath, fileCount: files.length, bytes };
}

export type ImportResearchOptions = {
  /** Required when the archive would replace an existing notebook.db. */
  confirmNotebookReplace?: boolean;
  /** Skip the automatic pre-import backup (tests only). */
  skipPreBackup?: boolean;
};

export type ImportResearchOk = {
  status: "ok";
  extracted: number;
  notebookReplaced: boolean;
  preBackupZipPath: string | null;
};

export type ImportResearchNeedsConfirm = {
  status: "needs_confirm";
  reason: "notebook_replace";
  message: string;
};

export type ImportResearchResult =
  ImportResearchOk | ImportResearchNeedsConfirm;

function entryUncompressedSize(entry: JSZip.JSZipObject): number {
  const data = (entry as unknown as { _data?: { uncompressedSize?: number } })
    ._data;
  if (typeof data?.uncompressedSize === "number") return data.uncompressedSize;
  return 0;
}

/**
 * Extract a research backup zip into `.research/`.
 * Rejects zip-slip paths, caps entry count and uncompressed size, skips
 * symlinks on export, auto-backs up the current tree, and requires explicit
 * confirmation before replacing `notebook.db`.
 */
export async function importResearchZip(
  projectPath: string,
  zipPath: string,
  opts?: ImportResearchOptions,
): Promise<ImportResearchResult> {
  const research = researchDir(projectPath);
  mkdirSync(research, { recursive: true });

  const buf = readFileSync(path.resolve(zipPath));
  const zip = await JSZip.loadAsync(buf);

  const allNames = Object.keys(zip.files);
  if (allNames.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `Zip has too many entries (${allNames.length} > ${MAX_ZIP_ENTRIES})`,
    );
  }

  let plannedBytes = 0;
  const fileEntries: { rel: string; name: string }[] = [];

  for (const name of allNames) {
    const entry = zip.files[name]!;
    if (entry.dir) {
      const trimmed = name.replace(/\/+$/, "");
      if (!trimmed || trimmed === ".") continue;
      // Still validate directory names so mkdir cannot escape.
      assertSafeZipEntryName(trimmed, research);
      continue;
    }
    const rel = assertSafeZipEntryName(name, research);
    if (shouldExcludeResearchRel(rel)) continue;
    plannedBytes += entryUncompressedSize(entry);
    if (plannedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Zip uncompressed size exceeds ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes`,
      );
    }
    fileEntries.push({ rel, name });
  }

  const wouldReplaceNotebook =
    fileEntries.some((e) => e.rel === "notebook.db") &&
    existsSync(path.join(research, "notebook.db"));

  if (wouldReplaceNotebook && !opts?.confirmNotebookReplace) {
    return {
      status: "needs_confirm",
      reason: "notebook_replace",
      message:
        "This backup includes notebook.db and would replace the current database. Confirm to proceed (a pre-import backup is taken first).",
    };
  }

  let preBackupZipPath: string | null = null;
  if (!opts?.skipPreBackup) {
    try {
      const pre = await exportResearchZip(projectPath);
      preBackupZipPath = pre.zipPath;
    } catch {
      // Empty / unreadable trees still proceed; safety nets are path checks.
      preBackupZipPath = null;
    }
  }

  let extracted = 0;
  let notebookReplaced = false;
  let writtenBytes = 0;

  for (const { rel, name } of fileEntries) {
    const abs = path.join(research, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    // Re-check after join (defense in depth).
    assertSafeZipEntryName(rel, research);
    const data = await zip.files[name]!.async("nodebuffer");
    writtenBytes += data.length;
    if (writtenBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Zip uncompressed size exceeds ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes`,
      );
    }
    writeFileSync(abs, data);
    extracted++;
    if (rel === "notebook.db") notebookReplaced = true;
  }

  return {
    status: "ok",
    extracted,
    notebookReplaced,
    preBackupZipPath,
  };
}

/** Stream helper for API download (optional). */
export function readZipStream(zipPath: string): Readable {
  return createReadStream(path.resolve(zipPath));
}
