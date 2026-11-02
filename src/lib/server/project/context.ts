import "server-only";

import { readBrief } from "./init";
import { listPinnedRecords, listRecords } from "./records";
import type { MemoryRecord } from "./types";

import { formatAlreadyTestedSection } from "@/lib/server/experiments/already-tested";
import { hybridSearch } from "@/lib/server/memory/search";
import { getMemorySettings } from "@/lib/server/memory/settings";
import { getSessionSummary } from "@/lib/server/memory/session-summary";

/** Rough token estimate: ~4 characters per token. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

export type ContextRef = {
  refId: string;
  kind:
    "brief" | "pinned" | "hypothesis" | "record" | "session" | "doc" | "paper";
  ownerId: string;
  title: string;
  snippet: string;
  tokens: number;
};

export type ProjectContextResult = {
  systemText: string;
  briefTokens: number;
  pinnedCount: number;
  pinnedTokens: number;
  relevantCount: number;
  totalTokens: number;
  items: ContextRef[];
  vectorUsed: boolean;
  /** @deprecated alias for pinnedCount — Task 3 callers */
  // kept for estimate route compatibility
};

function typePrefix(type: string): string {
  switch (type) {
    case "hypothesis":
      return "H";
    case "experiment":
      return "E";
    case "decision":
      return "D";
    case "paper":
      return "P";
    case "question":
      return "Q";
    case "note":
      return "N";
    case "session_summary":
      return "S";
    case "doc_chunk":
      return "C";
    default:
      return "M";
  }
}

function oneLine(body: string, max = 160): string {
  return (body.trim().split("\n")[0] ?? "").slice(0, max);
}

function formatRecordLine(refId: string, r: MemoryRecord): string {
  const line = oneLine(r.body);
  const status = r.status ? ` (${r.status})` : "";
  return `- [${refId}] ${r.title}${status}: ${line}`;
}

/**
 * Build the shared context package for solo + council.
 * Order: brief → pinned → active hypotheses → hybrid top-K (budget).
 */
export async function buildProjectSystemContext(
  projectPath: string,
  opts?: { userMessage?: string; chatId?: string },
): Promise<ProjectContextResult> {
  const settings = getMemorySettings(projectPath);
  const budget = settings.memoryTokens;
  const items: ContextRef[] = [];
  const seen = new Set<string>();
  let used = 0;

  const parts: string[] = [
    "You are assisting inside an Araitchi research project.",
    "Cite memory items by their reference ids (e.g. [H-12]) when you use them.",
    "",
  ];

  // 1. Brief (cap ~2000 tokens, but within overall budget)
  const briefCap = Math.min(2000, Math.floor(budget * 0.4));
  const briefRaw = readBrief(projectPath).trim();
  const brief = truncateToTokens(briefRaw, briefCap);
  const briefTokens = approxTokens(brief);
  parts.push("## Project brief", brief || "_Empty brief._", "");
  used += briefTokens;
  items.push({
    refId: "brief",
    kind: "brief",
    ownerId: "brief",
    title: "Project brief",
    snippet: brief.slice(0, 200),
    tokens: briefTokens,
  });

  // 2. Pinned
  const pinned = listPinnedRecords(projectPath);
  const pinnedLines: string[] = [];
  let pinnedTokens = 0;
  for (const r of pinned) {
    const refId = `${typePrefix(r.type)}-${r.id.slice(0, 6)}`;
    const line = formatRecordLine(refId, r);
    const t = approxTokens(line);
    if (used + t > budget) break;
    pinnedLines.push(line);
    pinnedTokens += t;
    used += t;
    seen.add(r.id);
    items.push({
      refId,
      kind: "pinned",
      ownerId: r.id,
      title: r.title,
      snippet: oneLine(r.body),
      tokens: t,
    });
  }
  if (pinnedLines.length) {
    parts.push("## Pinned memory", ...pinnedLines, "");
  }

  // 3. Active hypotheses (proposed|testing)
  const hyps = listRecords(projectPath, { type: "hypothesis" }).filter(
    (r) =>
      !seen.has(r.id) && (r.status === "proposed" || r.status === "testing"),
  );
  const hypLines: string[] = [];
  for (const r of hyps) {
    const refId = `H-${r.id.slice(0, 6)}`;
    const line = formatRecordLine(refId, r);
    const t = approxTokens(line);
    if (used + t > budget) break;
    hypLines.push(line);
    used += t;
    seen.add(r.id);
    items.push({
      refId,
      kind: "hypothesis",
      ownerId: r.id,
      title: r.title,
      snippet: oneLine(r.body),
      tokens: t,
    });
  }
  if (hypLines.length) {
    parts.push("## Active hypotheses", ...hypLines, "");
  }

  // 3b. Already tested (refuted / inconclusive / supported)
  const already = formatAlreadyTestedSection(projectPath);
  if (already) {
    const t = approxTokens(already);
    if (used + t <= budget) {
      parts.push(already);
      used += t;
      items.push({
        refId: "already-tested",
        kind: "record",
        ownerId: "already-tested",
        title: "Already tested",
        snippet: already.slice(0, 200),
        tokens: t,
      });
    }
  }

  // 4. Hybrid relevant
  let vectorUsed = true;
  let relevantCount = 0;
  const userMessage = opts?.userMessage?.trim();
  if (userMessage && used < budget) {
    const { hits, vectorUsed: vu } = await hybridSearch(projectPath, {
      query: userMessage,
      limit: 12,
      excludeChatId: opts?.chatId,
    });
    vectorUsed = vu;
    const relLines: string[] = [];
    for (const hit of hits) {
      if (hit.ownerType === "record") {
        if (seen.has(hit.ownerId)) continue;
        const r = listRecords(projectPath).find((x) => x.id === hit.ownerId);
        if (!r) continue;
        const refId = `${typePrefix(r.type)}-${r.id.slice(0, 6)}`;
        const line = formatRecordLine(refId, r);
        const t = approxTokens(line);
        if (used + t > budget) break;
        relLines.push(line);
        used += t;
        seen.add(r.id);
        relevantCount++;
        items.push({
          refId,
          kind: "record",
          ownerId: r.id,
          title: r.title,
          snippet: oneLine(r.body),
          tokens: t,
        });
      } else if (hit.ownerType === "session_summary") {
        if (opts?.chatId && hit.ownerId === opts.chatId) continue;
        const key = `session:${hit.ownerId}`;
        if (seen.has(key)) continue;
        const sum = getSessionSummary(projectPath, hit.ownerId);
        if (!sum) continue;
        const refId = `S-${hit.ownerId.slice(0, 6)}`;
        const snippet = truncateToTokens(sum.summary, 200);
        const line = `- [${refId}] Prior chat summary: ${oneLine(snippet, 200)}`;
        const t = approxTokens(line);
        if (used + t > budget) break;
        relLines.push(line);
        used += t;
        seen.add(key);
        relevantCount++;
        items.push({
          refId,
          kind: "session",
          ownerId: hit.ownerId,
          title: "Prior chat summary",
          snippet: oneLine(snippet, 200),
          tokens: t,
        });
      } else if (hit.ownerType === "doc_chunk" || hit.ownerType === "paper") {
        const key = `${hit.ownerType}:${hit.ownerId}:${hit.chunkIdx}`;
        if (seen.has(key)) continue;
        const prefix = hit.ownerType === "paper" ? "P" : "C";
        const refId = `${prefix}-${hit.ownerId.slice(0, 6)}`;
        const snippet = oneLine(hit.text, 220);
        const line = `- [${refId}] ${snippet}`;
        const t = approxTokens(line);
        if (used + t > budget) break;
        relLines.push(line);
        used += t;
        seen.add(key);
        relevantCount++;
        items.push({
          refId,
          kind: hit.ownerType === "paper" ? "paper" : "doc",
          ownerId: hit.ownerId,
          title: snippet.slice(0, 80),
          snippet,
          tokens: t,
        });
      }
    }
    if (relLines.length) {
      parts.push("## Relevant memory", ...relLines, "");
    }
  }

  return {
    systemText: parts.join("\n"),
    briefTokens,
    pinnedCount: pinnedLines.length,
    pinnedTokens,
    relevantCount,
    totalTokens: used,
    items,
    vectorUsed,
  };
}
