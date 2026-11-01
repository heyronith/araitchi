import "server-only";

import { readBrief } from "./init";
import { listPinnedRecords } from "./records";

/** Rough token estimate: ~4 characters per token. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

export type ProjectContextResult = {
  systemText: string;
  briefTokens: number;
  pinnedCount: number;
  pinnedTokens: number;
};

/**
 * Build a system message from brief.md + pinned records.
 * Caps: brief ~2000 tokens, pinned ~1000 tokens.
 */
export function buildProjectSystemContext(
  projectPath: string,
): ProjectContextResult {
  const briefRaw = readBrief(projectPath).trim();
  const brief = truncateToTokens(briefRaw, 2000);
  const briefTokens = approxTokens(brief);

  const pinned = listPinnedRecords(projectPath);
  const pinnedLines: string[] = [];
  let pinnedTokens = 0;
  for (const r of pinned) {
    const oneLine = (r.body.trim().split("\n")[0] ?? "").slice(0, 200);
    const line = `- [${r.type}] ${r.title}: ${oneLine}`;
    const t = approxTokens(line);
    if (pinnedTokens + t > 1000) break;
    pinnedLines.push(line);
    pinnedTokens += t;
  }

  const parts = [
    "You are assisting inside an Araitchi research project.",
    "",
    "## Project brief",
    brief || "_Empty brief._",
  ];

  if (pinnedLines.length) {
    parts.push("", "## Pinned memory", ...pinnedLines);
  }

  return {
    systemText: parts.join("\n"),
    briefTokens,
    pinnedCount: pinnedLines.length,
    pinnedTokens,
  };
}
