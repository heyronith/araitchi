import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { getNotebookDb } from "@/lib/server/project/db";
import { toolCache } from "@/lib/server/project/schema";

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashArgs(args: unknown): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex");
}

export function getCached(
  projectPath: string,
  tool: string,
  argsHash: string,
  ttlSec: number,
): string | null {
  if (ttlSec <= 0) return null;
  const row = getNotebookDb(projectPath)
    .select()
    .from(toolCache)
    .where(and(eq(toolCache.tool, tool), eq(toolCache.argsHash, argsHash)))
    .get();
  if (!row) return null;
  if (Date.now() - row.createdAt > ttlSec * 1000) return null;
  return row.result;
}

export function setCached(
  projectPath: string,
  tool: string,
  argsHash: string,
  result: string,
): void {
  const now = Date.now();
  getNotebookDb(projectPath)
    .insert(toolCache)
    .values({ tool, argsHash, result, createdAt: now })
    .onConflictDoUpdate({
      target: [toolCache.tool, toolCache.argsHash],
      set: { result, createdAt: now },
    })
    .run();
}
