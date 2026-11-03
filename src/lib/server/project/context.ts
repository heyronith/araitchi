import "server-only";

import { formatAlreadyTestedSection } from "@/lib/server/experiments/already-tested";
import { formatActivityForContext } from "@/lib/server/continuity/activity";
import { buildInstructionLayers } from "@/lib/server/continuity/instructions";
import { projectTree } from "@/lib/server/continuity/indexer";
import { stateForContext } from "@/lib/server/continuity/state";
import { hybridSearch } from "@/lib/server/memory/search";
import { getMemorySettings } from "@/lib/server/memory/settings";
import { getSessionSummary } from "@/lib/server/memory/session-summary";

import { readBrief } from "./init";
import { listPinnedRecords, listRecords } from "./records";
import type { MemoryRecord } from "./types";

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
    | "brief"
    | "state"
    | "instructions"
    | "pinned"
    | "hypothesis"
    | "record"
    | "session"
    | "doc"
    | "paper"
    | "file"
    | "activity"
    | "handoff";
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
  layerIds: string[];
  handoffNote: string | null;
  budgetTokens: number;
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

/** Memory budget = min(setting, ~25% of model context window). */
export function resolveContextBudget(
  projectPath: string,
  modelId?: string | null,
): number {
  const settings = getMemorySettings(projectPath);
  const settingBudget = settings.memoryTokens;
  if (!modelId) return settingBudget;
  const window = lookupModelContextWindow(modelId);
  if (typeof window === "number" && window > 0) {
    return Math.min(settingBudget, Math.floor(window * 0.25));
  }
  return settingBudget;
}

/**
 * Build the shared context package for solo + council.
 * Priority: instructions → STATE.md → chat summary → recent/relevant memory → files → activity.
 */
export async function buildProjectSystemContext(
  projectPath: string,
  opts?: {
    userMessage?: string;
    chatId?: string;
    modelId?: string | null;
    /** Prior messages omitted due to window / model switch. */
    handoffSummarizedCount?: number;
    role?: import("@/lib/server/continuity/instructions").InstructionRole;
  },
): Promise<ProjectContextResult> {
  const budget = resolveContextBudget(projectPath, opts?.modelId);
  const items: ContextRef[] = [];
  const seen = new Set<string>();
  let used = 0;
  const layerIds: string[] = [];

  const parts: string[] = [
    "You are assisting inside an Araitchi research project.",
    "Cite memory items by their reference ids (e.g. [H-12]) when you use them.",
    "Prefer `.research/STATE.md` for \"where we are / what's tested / what's next\".",
    "",
  ];

  // 1. Instructions
  const instr = buildInstructionLayers(projectPath, opts?.role ?? "default");
  layerIds.push(...instr.layerIds);
  if (instr.systemBlock.trim()) {
    const block = truncateToTokens(instr.systemBlock, Math.min(2000, budget));
    const t = approxTokens(block);
    parts.push(block, "");
    used += t;
    items.push({
      refId: "instructions",
      kind: "instructions",
      ownerId: "instructions",
      title: `Instructions (${layerIds.join(", ") || "none"})`,
      snippet: layerIds.join(", "),
      tokens: t,
    });
  }

  // 2. STATE.md (always early; ~1500 token cap)
  const stateCap = Math.min(1500, Math.max(400, budget - used));
  const state = stateForContext(projectPath, stateCap);
  {
    const t = approxTokens(state);
    parts.push("## Project state (STATE.md)", state, "");
    used += t;
    items.push({
      refId: "state",
      kind: "state",
      ownerId: "STATE.md",
      title: "Project state",
      snippet: state.slice(0, 200),
      tokens: t,
    });
  }

  // 2b. Brief (supplementary; Goal also mirrored into STATE)
  {
    const briefCap = Math.min(800, Math.floor((budget - used) * 0.25));
    if (briefCap > 80) {
      const brief = truncateToTokens(readBrief(projectPath).trim(), briefCap);
      const t = approxTokens(brief);
      parts.push("## Project brief", brief || "_Empty brief._", "");
      used += t;
      items.push({
        refId: "brief",
        kind: "brief",
        ownerId: "brief",
        title: "Project brief",
        snippet: brief.slice(0, 200),
        tokens: t,
      });
    }
  }

  let handoffNote: string | null = null;
  if (opts?.handoffSummarizedCount && opts.handoffSummarizedCount > 0) {
    handoffNote = `Handoff: summary of ${opts.handoffSummarizedCount} earlier messages included`;
    const line = `## Handoff\n${handoffNote}`;
    const t = approxTokens(line);
    parts.push(line, "");
    used += t;
    items.push({
      refId: "handoff",
      kind: "handoff",
      ownerId: "handoff",
      title: "Handoff",
      snippet: handoffNote,
      tokens: t,
    });
  }

  // 3. Current chat session summary
  if (opts?.chatId) {
    const sum = getSessionSummary(projectPath, opts.chatId);
    if (sum?.summary) {
      const snippet = truncateToTokens(sum.summary, 400);
      const block = `## Current chat summary\n${snippet}`;
      const t = approxTokens(block);
      if (used + t <= budget) {
        parts.push(block, "");
        used += t;
        items.push({
          refId: `S-${opts.chatId.slice(0, 6)}`,
          kind: "session",
          ownerId: opts.chatId,
          title: "Current chat summary",
          snippet: oneLine(snippet, 200),
          tokens: t,
        });
      }
    }
  }

  // 4. Pinned
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

  // 5. Compact project tree (top 2 levels)
  try {
    const tree = projectTree({ projectPath, depth: 2 });
    const treeText = formatTreeCompact(tree);
    const block = truncateToTokens(`## Project map\n${treeText}`, 400);
    const t = approxTokens(block);
    if (used + t <= budget) {
      parts.push(block, "");
      used += t;
      items.push({
        refId: "project-map",
        kind: "file",
        ownerId: "tree",
        title: "Project map",
        snippet: treeText.slice(0, 120),
        tokens: t,
      });
    }
  } catch {
    /* indexer may be empty */
  }

  // 6. Active hypotheses (if not already covered by STATE)
  const hyps = listRecords(projectPath, { type: "hypothesis" }).filter(
    (r) =>
      !seen.has(r.id) && (r.status === "proposed" || r.status === "testing"),
  );
  const hypLines: string[] = [];
  for (const r of hyps.slice(0, 12)) {
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

  // 7. Already tested
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

  // 8. Recent activity
  {
    const act = formatActivityForContext(projectPath, 15);
    const block = `## Recent activity\n${act}`;
    const t = approxTokens(block);
    if (used + t <= budget) {
      parts.push(block, "");
      used += t;
      items.push({
        refId: "activity",
        kind: "activity",
        ownerId: "activity",
        title: "Recent activity",
        snippet: act.slice(0, 120),
        tokens: t,
      });
    }
  }

  // 9. Hybrid relevant memory / files
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
      } else if (
        hit.ownerType === "doc_chunk" ||
        hit.ownerType === "paper" ||
        hit.ownerType === "project_chunk"
      ) {
        const key = `${hit.ownerType}:${hit.ownerId}:${hit.chunkIdx}`;
        if (seen.has(key)) continue;
        const prefix =
          hit.ownerType === "paper"
            ? "P"
            : hit.ownerType === "project_chunk"
              ? "F"
              : "C";
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
          kind: hit.ownerType === "paper" ? "paper" : "file",
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

  // Context indicator footer for models
  parts.push(
    `## Context layers used`,
    layerIds.length ? layerIds.map((id) => `- ${id}`).join("\n") : "- (none)",
    handoffNote ? `- ${handoffNote}` : "",
    "",
  );

  return {
    systemText: parts.join("\n"),
    briefTokens: approxTokens(state),
    pinnedCount: pinnedLines.length,
    pinnedTokens,
    relevantCount,
    totalTokens: used,
    items,
    vectorUsed,
    layerIds,
    handoffNote,
    budgetTokens: budget,
  };
}

function formatTreeCompact(
  node: {
    type: string;
    name: string;
    path?: string;
    children?: unknown[];
  },
  indent = "",
): string {
  const lines: string[] = [];
  const label = node.type === "dir" ? `${node.name}/` : node.name;
  if (indent || node.name !== ".") lines.push(`${indent}${label}`);
  const kids = (node.children ?? []) as (typeof node)[];
  for (const c of kids.slice(0, 40)) {
    lines.push(formatTreeCompact(c, indent + "  "));
  }
  return lines.join("\n");
}

/** Optional catalog helper — soft dependency (no hard import; avoids missing-module build noise). */
function lookupModelContextWindow(_modelId: string): number | null {
  void _modelId;
  return null;
}
