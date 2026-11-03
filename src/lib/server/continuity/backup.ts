import "server-only";

import {
  createReadStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import JSZip from "jszip";

import { researchDir } from "@/lib/server/project/init";

const MODEL_EXT = new Set([
  ".onnx",
  ".bin",
  ".safetensors",
  ".pt",
  ".pth",
  ".gguf",
]);

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
  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(dir, name);
      const rel = relPosix(researchRoot, abs);
      if (shouldExcludeResearchRel(rel)) continue;
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) out.push(rel);
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

export type ImportResearchResult = {
  extracted: number;
  /** True when notebook.db was replaced from the archive. */
  notebookReplaced: boolean;
};

/**
 * Extract a research backup zip into `.research/`.
 * **Warning:** overwrites existing files (including `notebook.db`) when present in the zip.
 * Prefer importing into an empty `.research/` tree (tests use temp projects).
 */
export async function importResearchZip(
  projectPath: string,
  zipPath: string,
): Promise<ImportResearchResult> {
  const research = researchDir(projectPath);
  mkdirSync(research, { recursive: true });

  const buf = readFileSync(path.resolve(zipPath));
  const zip = await JSZip.loadAsync(buf);
  let extracted = 0;
  let notebookReplaced = false;

  const entries = Object.keys(zip.files).filter(
    (name) => !zip.files[name]!.dir && !shouldExcludeResearchRel(name),
  );

  for (const rel of entries) {
    const abs = path.join(research, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    const data = await zip.files[rel]!.async("nodebuffer");
    writeFileSync(abs, data);
    extracted++;
    if (rel === "notebook.db") notebookReplaced = true;
  }

  return { extracted, notebookReplaced };
}

/** Stream helper for API download (optional). */
export function readZipStream(zipPath: string): Readable {
  return createReadStream(path.resolve(zipPath));
}
