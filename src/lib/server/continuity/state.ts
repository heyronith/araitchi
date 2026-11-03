import "server-only";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { formatAlreadyTestedSection } from "@/lib/server/experiments/already-tested";
import {
  claimEntailedByQuote,
} from "@/lib/server/memory/evidence";
import { getNotebookDb } from "@/lib/server/project/db";
import { researchDir, readBrief } from "@/lib/server/project/init";
import { listRecords } from "@/lib/server/project/records";
import {
  stateHistory,
  stateProposals,
} from "@/lib/server/project/schema";
import { STATE_TEMPLATE } from "@/lib/server/project/templates";

import { recordActivity } from "./activity";

export const STATE_SECTIONS = [
  "Goal",
  "Current status",
  "Active hypotheses",
  "Key decisions",
  "Already tested",
  "Open questions",
  "Next steps",
] as const;

export type StateSection = (typeof STATE_SECTIONS)[number];

const GENERATED: ReadonlySet<StateSection> = new Set([
  "Active hypotheses",
  "Key decisions",
  "Already tested",
  "Open questions",
]);

const NARRATIVE: ReadonlySet<StateSection> = new Set([
  "Current status",
  "Next steps",
]);

export function statePath(projectPath: string): string {
  return path.join(researchDir(projectPath), "STATE.md");
}

export function ensureStateFile(projectPath: string): void {
  const file = statePath(projectPath);
  if (!existsSync(file)) {
    writeFileSync(file, STATE_TEMPLATE, "utf8");
  }
}

export function readStateMd(projectPath: string): string {
  ensureStateFile(projectPath);
  return readFileSync(statePath(projectPath), "utf8");
}

/** Parse ## sections (ATX headings). */
export function parseStateSections(
  markdown: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = markdown.split("\n");
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current) out[current] = buf.join("\n").trim();
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)\s*$/);
    if (m) {
      flush();
      current = m[1]!.trim();
      buf.length = 0;
      continue;
    }
    if (current) buf.push(line);
  }
  flush();
  return out;
}

function renderState(sections: Record<string, string>): string {
  const parts = ["# Project state", ""];
  for (const name of STATE_SECTIONS) {
    parts.push(`## ${name}`, "", sections[name]?.trim() || "_Empty._", "");
  }
  return parts.join("\n").trimEnd() + "\n";
}

function goalFromBrief(projectPath: string): string {
  const brief = readBrief(projectPath);
  const secs = parseStateSections(
    brief.replace(/^#\s+.+$/m, "# Brief").replace(/^## /gm, "## "),
  );
  // brief uses ## Goal
  const g = secs["Goal"]?.trim();
  if (g) return g;
  const m = brief.match(/##\s+Goal\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  return m?.[1]?.trim() || "_Set the research goal in brief.md or here._";
}

function generatedHypotheses(projectPath: string): string {
  const hyps = listRecords(projectPath, {
    type: "hypothesis",
    includeDeleted: false,
  }).filter((r) => r.status === "proposed" || r.status === "testing");
  if (!hyps.length) return "_No active hypotheses._";
  return hyps
    .map((r) => `- **${r.title}** (${r.status ?? "—"}): ${r.body.slice(0, 200)}`)
    .join("\n");
}

function generatedDecisions(projectPath: string): string {
  const rows = listRecords(projectPath, {
    type: "decision",
    includeDeleted: false,
  });
  if (!rows.length) return "_No key decisions recorded._";
  return rows
    .slice(0, 40)
    .map((r) => `- **${r.title}**: ${r.body.slice(0, 240)}`)
    .join("\n");
}

function generatedQuestions(projectPath: string): string {
  const rows = listRecords(projectPath, {
    type: "question",
    includeDeleted: false,
  }).filter((r) => r.status !== "answered" && r.status !== "archived");
  if (!rows.length) return "_No open questions._";
  return rows
    .slice(0, 40)
    .map((r) => `- ${r.title}: ${r.body.slice(0, 160)}`)
    .join("\n");
}

function pendingProposalsBlock(
  projectPath: string,
  section: "Current status" | "Next steps",
): string {
  const rows = getNotebookDb(projectPath)
    .select()
    .from(stateProposals)
    .where(eq(stateProposals.status, "pending"))
    .all()
    .filter((r) => r.section === section);
  if (!rows.length) return "";
  return (
    "\n\n### System proposals (accept in UI)\n" +
    rows
      .map(
        (r) =>
          `- (${r.id.slice(0, 8)}) ${r.content.slice(0, 300)}${
            r.evidenceQuote ? ` — _“${r.evidenceQuote.slice(0, 80)}”_` : ""
          }`,
      )
      .join("\n")
  );
}

/**
 * Rebuild generated sections from the notebook. Preserves user narrative
 * for Current status / Next steps / Goal (Goal refreshed from brief if empty).
 */
export function rebuildStateMd(
  projectPath: string,
  opts?: { source?: string; note?: string; skipHistory?: boolean },
): string {
  ensureStateFile(projectPath);
  const prev = parseStateSections(readStateMd(projectPath));

  const sections: Record<string, string> = {
    Goal: prev["Goal"]?.trim()
      ? prev["Goal"]!
      : goalFromBrief(projectPath),
    "Current status":
      (prev["Current status"] ?? "").replace(/\n### System proposals[\s\S]*$/, "").trim() +
      pendingProposalsBlock(projectPath, "Current status"),
    "Active hypotheses": generatedHypotheses(projectPath),
    "Key decisions": generatedDecisions(projectPath),
    "Already tested":
      formatAlreadyTestedSection(projectPath).trim() ||
      "_Nothing tested yet._",
    "Open questions": generatedQuestions(projectPath),
    "Next steps":
      (prev["Next steps"] ?? "").replace(/\n### System proposals[\s\S]*$/, "").trim() +
      pendingProposalsBlock(projectPath, "Next steps"),
  };

  // Preserve user narrative even if empty placeholder
  for (const n of NARRATIVE) {
    const raw = (prev[n] ?? "")
      .replace(/\n### System proposals[\s\S]*$/, "")
      .trim();
    if (raw && !raw.startsWith("_User-owned") && raw !== "_Empty._") {
      sections[n] =
        raw + pendingProposalsBlock(projectPath, n as "Current status" | "Next steps");
    } else if (!sections[n]?.trim()) {
      sections[n] =
        "_User-owned narrative._" +
        pendingProposalsBlock(projectPath, n as "Current status" | "Next steps");
    }
  }

  const content = renderState(sections);
  writeFileSync(statePath(projectPath), content, "utf8");

  if (!opts?.skipHistory) {
    getNotebookDb(projectPath)
      .insert(stateHistory)
      .values({
        id: nanoid(),
        content,
        source: opts?.source ?? "system",
        note: opts?.note ?? "rebuild",
        createdAt: Date.now(),
      })
      .run();
    recordActivity(projectPath, {
      kind: "state",
      summary: `STATE.md rebuilt (${opts?.note ?? "system"})`,
    });
  }
  return content;
}

/** Write a user edit for a narrative/goal section (wins over proposals). */
export function writeStateSection(
  projectPath: string,
  section: StateSection,
  body: string,
): string {
  if (GENERATED.has(section) && section !== "Goal") {
    throw new Error(`${section} is generated; edit records instead`);
  }
  ensureStateFile(projectPath);
  const prev = parseStateSections(readStateMd(projectPath));
  prev[section] = body.trim();
  const content = renderState(
    Object.fromEntries(STATE_SECTIONS.map((s) => [s, prev[s] ?? ""])),
  );
  writeFileSync(statePath(projectPath), content, "utf8");
  getNotebookDb(projectPath)
    .insert(stateHistory)
    .values({
      id: nanoid(),
      content,
      source: "user",
      note: `edit ${section}`,
      createdAt: Date.now(),
    })
    .run();
  rebuildStateMd(projectPath, {
    source: "user",
    note: `after user edit ${section}`,
    skipHistory: true,
  });
  return readStateMd(projectPath);
}

export function listPendingStateProposals(projectPath: string) {
  return getNotebookDb(projectPath)
    .select({
      id: stateProposals.id,
      section: stateProposals.section,
      content: stateProposals.content,
      evidenceQuote: stateProposals.evidenceQuote,
      createdAt: stateProposals.createdAt,
    })
    .from(stateProposals)
    .where(eq(stateProposals.status, "pending"))
    .orderBy(desc(stateProposals.createdAt))
    .all();
}

export function listStateHistory(
  projectPath: string,
  limit = 20,
): { id: string; source: string; note: string | null; createdAt: number }[] {
  return getNotebookDb(projectPath)
    .select({
      id: stateHistory.id,
      source: stateHistory.source,
      note: stateHistory.note,
      createdAt: stateHistory.createdAt,
    })
    .from(stateHistory)
    .orderBy(desc(stateHistory.createdAt))
    .limit(limit)
    .all();
}

export function getStateHistoryEntry(
  projectPath: string,
  id: string,
): { id: string; content: string; source: string; note: string | null; createdAt: number } | null {
  return (
    getNotebookDb(projectPath)
      .select()
      .from(stateHistory)
      .where(eq(stateHistory.id, id))
      .get() ?? null
  );
}

export function proposeStateNarrative(
  projectPath: string,
  input: {
    section: "Current status" | "Next steps";
    content: string;
    evidenceQuote: string;
  },
): string | null {
  if (
    !claimEntailedByQuote({
      title: input.content.slice(0, 120),
      body: input.content,
      quote: input.evidenceQuote,
    })
  ) {
    return null;
  }
  const id = nanoid();
  getNotebookDb(projectPath)
    .insert(stateProposals)
    .values({
      id,
      section: input.section,
      content: input.content.trim(),
      evidenceQuote: input.evidenceQuote,
      status: "pending",
      createdAt: Date.now(),
    })
    .run();
  rebuildStateMd(projectPath, { note: "proposal" });
  return id;
}

export function acceptStateProposal(
  projectPath: string,
  proposalId: string,
): boolean {
  const row = getNotebookDb(projectPath)
    .select()
    .from(stateProposals)
    .where(eq(stateProposals.id, proposalId))
    .get();
  if (!row || row.status !== "pending") return false;
  const section = row.section as "Current status" | "Next steps";
  const prev = parseStateSections(readStateMd(projectPath));
  const base = (prev[section] ?? "")
    .replace(/\n### System proposals[\s\S]*$/, "")
    .trim();
  const next = [base, row.content].filter(Boolean).join("\n\n");
  getNotebookDb(projectPath)
    .update(stateProposals)
    .set({ status: "accepted" })
    .where(eq(stateProposals.id, proposalId))
    .run();
  writeStateSection(projectPath, section, next);
  return true;
}

export function dismissStateProposal(
  projectPath: string,
  proposalId: string,
): boolean {
  const row = getNotebookDb(projectPath)
    .select()
    .from(stateProposals)
    .where(eq(stateProposals.id, proposalId))
    .get();
  if (!row) return false;
  getNotebookDb(projectPath)
    .update(stateProposals)
    .set({ status: "dismissed" })
    .where(eq(stateProposals.id, proposalId))
    .run();
  rebuildStateMd(projectPath, { note: "dismiss proposal" });
  return true;
}

/** Cap ~1500 tokens for context. */
export function stateForContext(projectPath: string, maxTokens = 1500): string {
  ensureStateFile(projectPath);
  const raw = readStateMd(projectPath);
  const maxChars = maxTokens * 4;
  if (raw.length <= maxChars) return raw;
  // Priority trim: keep Goal, Current status, Already tested, Next steps first
  const secs = parseStateSections(raw);
  const priority: StateSection[] = [
    "Goal",
    "Current status",
    "Already tested",
    "Active hypotheses",
    "Next steps",
    "Key decisions",
    "Open questions",
  ];
  const kept: string[] = ["# Project state", ""];
  let used = 20;
  for (const name of priority) {
    const body = (secs[name] ?? "").trim() || "_Empty._";
    const block = `## ${name}\n\n${body}\n`;
    if (used + block.length > maxChars) {
      const room = maxChars - used - `## ${name}\n\n`.length - 2;
      if (room > 40) {
        kept.push(`## ${name}`, "", body.slice(0, room - 1) + "…", "");
      }
      break;
    }
    kept.push(`## ${name}`, "", body, "");
    used += block.length;
  }
  return kept.join("\n").trimEnd() + "\n";
}
