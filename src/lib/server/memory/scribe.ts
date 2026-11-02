import "server-only";

import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { extractJsonObject } from "@/lib/server/council/analysis";
import { createOpenRouterClient } from "@/lib/server/openrouter";
import { getNotebookDb } from "@/lib/server/project/db";
import {
  createRecord,
  getRecord,
  listRecords,
  softDeleteRecord,
  updateRecord,
} from "@/lib/server/project/records";
import { scribeBatches, scribeSuggestions } from "@/lib/server/project/schema";
import type { MemoryRecord, RecordType } from "@/lib/server/project/types";
import { loadPrompt } from "@/lib/server/prompts/load";

import { findNearDuplicate } from "./search";
import {
  defaultStatusForCreate,
  sanitizeScribeStatus,
  SCRIBE_REPAIR_PROMPT,
  scribeCreateSchema,
  scribeOutputSchema,
  scribeUpdateSchema,
  type ScribeCreate,
  type ScribeOutput,
  type ScribeUpdate,
} from "./scribe-schema";
import {
  getMemorySettings,
  resolveScribeModelId,
  setMemorySettings,
} from "./settings";
import { maybeUpdateSessionSummary } from "./session-summary";

export type ScribeRunInput = {
  projectPath: string;
  chatId: string;
  messageId: string;
  userText: string;
  replyText: string;
  /** Model that produced the reply (solo model or synthesizer). */
  sourceModel: string;
  apiKey: string;
  councilAnalysisJson?: string | null;
  /** Injected for tests / e2e mock. */
  mockOutput?: ScribeOutput | null;
  signal?: AbortSignal;
};

export type ScribeBatchSummary = {
  batchId: string;
  costUsd: number | null;
  created: { id: string; type: string; title: string }[];
  updated: { id: string; type: string; title: string }[];
  suggestions: number;
  line: string;
  requireReview: boolean;
};

export function parseScribeOutput(
  text: string,
): { ok: true; output: ScribeOutput } | { ok: false; error: string } {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, error: "No JSON object found" };
  try {
    const parsed = JSON.parse(json) as unknown;
    const result = scribeOutputSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, error: result.error.message };
    }
    // Enforce caps even if zod default somehow bypassed
    const create = result.data.create.slice(0, 5);
    const update = result.data.update.slice(0, 5);
    return { ok: true, output: { create, update } };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "JSON parse failed",
    };
  }
}

function compactActiveRecords(projectPath: string) {
  return listRecords(projectPath)
    .slice(0, 80)
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      status: r.status,
    }));
}

function wrapUntrustedReply(text: string): string {
  const safe = text.replace(/<\/assistant_reply/gi, "&lt;/assistant_reply");
  return `<assistant_reply untrusted="true">\n${safe}\n</assistant_reply>`;
}

function summarizeLine(
  created: { type: string }[],
  updated: { type: string }[],
): string {
  const countBy = (items: { type: string }[]) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.type, (m.get(i.type) ?? 0) + 1);
    return [...m.entries()]
      .map(([t, n]) => `+${n} ${t}${n === 1 ? "" : "s"}`)
      .join(" · ");
  };
  const parts: string[] = [];
  if (created.length) parts.push(countBy(created));
  if (updated.length) {
    const m = new Map<string, number>();
    for (const i of updated) m.set(i.type, (m.get(i.type) ?? 0) + 1);
    parts.push(
      [...m.entries()]
        .map(([t, n]) => `${n} ${t}${n === 1 ? "" : "s"} updated`)
        .join(" · "),
    );
  }
  return parts.length
    ? `Memory: ${parts.join(" · ")}`
    : "Memory: (nothing new)";
}

async function callScribeModel(input: {
  apiKey: string;
  modelId: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<{ text: string; costUsd: number | null }> {
  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });
  const result = await generateText({
    model,
    system: input.system,
    prompt: input.user,
    abortSignal: input.signal,
  });
  const cost =
    (
      (await result.providerMetadata)?.openrouter as
        { usage?: { cost?: number } } | undefined
    )?.usage?.cost ?? null;
  return { text: result.text, costUsd: cost };
}

export async function runScribe(
  input: ScribeRunInput,
): Promise<ScribeBatchSummary | null> {
  const settings = getMemorySettings(input.projectPath);
  if (!settings.scribeEnabled) return null;

  let output: ScribeOutput;
  let costUsd: number | null = null;

  if (input.mockOutput) {
    output = {
      create: input.mockOutput.create.slice(0, 5),
      update: input.mockOutput.update.slice(0, 5),
    };
  } else if (process.env.ARAITCHI_MOCK_SCRIBE) {
    try {
      output = scribeOutputSchema.parse(
        JSON.parse(process.env.ARAITCHI_MOCK_SCRIBE),
      );
    } catch {
      return null;
    }
  } else {
    const system = loadPrompt("scribe.md");
    const existing = compactActiveRecords(input.projectPath);
    const user = [
      "## Last user message",
      input.userText.slice(0, 8000),
      "",
      "## Assistant reply",
      wrapUntrustedReply(input.replyText.slice(0, 12000)),
      "",
      input.councilAnalysisJson
        ? `## Council analysis\n${input.councilAnalysisJson.slice(0, 4000)}\n`
        : "",
      "## Existing active records (prefer update)",
      JSON.stringify(existing),
    ].join("\n");

    const modelId = resolveScribeModelId(input.projectPath);
    const first = await callScribeModel({
      apiKey: input.apiKey,
      modelId,
      system,
      user,
      signal: input.signal,
    });
    const text = first.text;
    costUsd = first.costUsd;
    let parsed = parseScribeOutput(text);
    if (!parsed.ok) {
      const repair = await callScribeModel({
        apiKey: input.apiKey,
        modelId,
        system,
        user: `${user}\n\n${SCRIBE_REPAIR_PROMPT}\nPrevious reply:\n${text.slice(0, 2000)}`,
        signal: input.signal,
      });
      costUsd = (costUsd ?? 0) + (repair.costUsd ?? 0);
      parsed = parseScribeOutput(repair.text);
      if (!parsed.ok) return null;
    }
    output = parsed.output;
  }

  setMemorySettings(input.projectPath, { lastScribeCostUsd: costUsd });

  const batchId = nanoid();
  const created: MemoryRecord[] = [];
  const updated: MemoryRecord[] = [];
  const undoSnapshot: {
    createdIds: string[];
    updates: {
      id: string;
      prevBody: string;
      prevStatus: string | null;
    }[];
    suggestionIds: string[];
  } = { createdIds: [], updates: [], suggestionIds: [] };

  const requireReview = settings.scribeRequireReview;

  const queueSuggestion = (action: "create" | "update", payload: unknown) => {
    const sid = nanoid();
    getNotebookDb(input.projectPath)
      .insert(scribeSuggestions)
      .values({
        id: sid,
        batchId,
        action,
        payload: JSON.stringify(payload),
        status: "pending",
        createdAt: Date.now(),
      })
      .run();
    undoSnapshot.suggestionIds.push(sid);
  };

  const applyCreate = async (item: ScribeCreate) => {
    const text = `${item.title}\n${item.body}`;
    const dup = await findNearDuplicate(
      input.projectPath,
      item.type as RecordType,
      text,
      0.9,
    );
    if (dup) {
      const existing = getRecord(input.projectPath, dup.id);
      if (!existing) return;
      const updatePayload: ScribeUpdate = {
        id: existing.id,
        status: item.status ?? undefined,
        appendBody: existing.body.includes(item.body) ? undefined : item.body,
      };
      if (requireReview) {
        queueSuggestion("update", updatePayload);
        return;
      }
      undoSnapshot.updates.push({
        id: existing.id,
        prevBody: existing.body,
        prevStatus: existing.status,
      });
      const status = sanitizeScribeStatus(
        existing.type,
        existing.status,
        item.status,
      );
      const rec = updateRecord(input.projectPath, existing.id, {
        body: existing.body.includes(item.body)
          ? existing.body
          : `${existing.body}\n\n${item.body}`,
        ...(status !== undefined ? { status } : {}),
      });
      if (rec) updated.push(rec);
      return;
    }

    if (requireReview) {
      queueSuggestion("create", item);
      return;
    }

    const rec = createRecord(input.projectPath, {
      type: item.type,
      title: item.title,
      body: item.body,
      status: defaultStatusForCreate(item.type, item.status),
      tags: item.tags,
      source: input.sourceModel,
      sourceChatId: input.chatId,
      sourceMessageId: input.messageId,
      createdBy: "scribe",
    });
    created.push(rec);
    undoSnapshot.createdIds.push(rec.id);
  };

  const applyUpdate = async (item: ScribeUpdate) => {
    const existing = getRecord(input.projectPath, item.id);
    if (!existing || existing.deletedAt) return;

    if (requireReview) {
      queueSuggestion("update", item);
      return;
    }

    undoSnapshot.updates.push({
      id: existing.id,
      prevBody: existing.body,
      prevStatus: existing.status,
    });
    const status = sanitizeScribeStatus(
      existing.type,
      existing.status,
      item.status,
    );
    const body =
      item.appendBody && !existing.body.includes(item.appendBody)
        ? `${existing.body}\n\n${item.appendBody}`
        : existing.body;
    const rec = updateRecord(input.projectPath, existing.id, {
      body,
      ...(status !== undefined ? { status } : {}),
    });
    if (rec) updated.push(rec);
  };

  for (const c of output.create) await applyCreate(c);
  for (const u of output.update) await applyUpdate(u);

  getNotebookDb(input.projectPath)
    .insert(scribeBatches)
    .values({
      id: batchId,
      chatId: input.chatId,
      messageId: input.messageId,
      payload: JSON.stringify(undoSnapshot),
      costUsd,
      createdAt: Date.now(),
      undoneAt: null,
    })
    .run();

  void maybeUpdateSessionSummary({
    projectPath: input.projectPath,
    chatId: input.chatId,
    apiKey: input.apiKey,
    force: false,
  }).catch(() => undefined);

  const line = summarizeLine(
    created.map((r) => ({ type: r.type })),
    updated.map((r) => ({ type: r.type })),
  );

  const suggestionCount = undoSnapshot.suggestionIds.length;
  return {
    batchId,
    costUsd,
    created: created.map((r) => ({ id: r.id, type: r.type, title: r.title })),
    updated: updated.map((r) => ({ id: r.id, type: r.type, title: r.title })),
    suggestions: suggestionCount,
    line:
      requireReview && suggestionCount > 0
        ? `Memory: ${suggestionCount} suggestion${suggestionCount === 1 ? "" : "s"} pending review`
        : line,
    requireReview,
  };
}

/** Revert a scribe batch (soft-delete creates, restore prior bodies/status). */
export function undoScribeBatch(projectPath: string, batchId: string): boolean {
  const db = getNotebookDb(projectPath);
  const batch = db
    .select()
    .from(scribeBatches)
    .where(eq(scribeBatches.id, batchId))
    .get();
  if (!batch || batch.undoneAt) return false;

  let snap: {
    createdIds: string[];
    updates: { id: string; prevBody: string; prevStatus: string | null }[];
    suggestionIds: string[];
  };
  try {
    snap = JSON.parse(batch.payload) as typeof snap;
  } catch {
    return false;
  }

  for (const id of snap.createdIds ?? []) {
    softDeleteRecord(projectPath, id);
  }
  for (const u of snap.updates ?? []) {
    updateRecord(projectPath, u.id, {
      body: u.prevBody,
      status: (u.prevStatus as MemoryRecord["status"]) ?? null,
    });
  }
  for (const sid of snap.suggestionIds ?? []) {
    db.update(scribeSuggestions)
      .set({ status: "dismissed" })
      .where(eq(scribeSuggestions.id, sid))
      .run();
  }

  db.update(scribeBatches)
    .set({ undoneAt: Date.now() })
    .where(eq(scribeBatches.id, batchId))
    .run();
  return true;
}

export function acceptSuggestion(
  projectPath: string,
  suggestionId: string,
  sourceModel = "scribe",
): MemoryRecord | null {
  const db = getNotebookDb(projectPath);
  const row = db
    .select()
    .from(scribeSuggestions)
    .where(eq(scribeSuggestions.id, suggestionId))
    .get();
  if (!row || row.status !== "pending") return null;

  const batch = db
    .select()
    .from(scribeBatches)
    .where(eq(scribeBatches.id, row.batchId))
    .get();

  let rec: MemoryRecord | null = null;
  if (row.action === "create") {
    const item = scribeCreateSchema.parse(JSON.parse(row.payload));
    rec = createRecord(projectPath, {
      type: item.type,
      title: item.title,
      body: item.body,
      status: defaultStatusForCreate(item.type, item.status),
      tags: item.tags,
      source: sourceModel,
      sourceChatId: batch?.chatId ?? null,
      sourceMessageId: batch?.messageId ?? null,
      createdBy: "scribe",
    });
  } else if (row.action === "update") {
    const item = scribeUpdateSchema.parse(JSON.parse(row.payload));
    const existing = getRecord(projectPath, item.id);
    if (existing) {
      const status = sanitizeScribeStatus(
        existing.type,
        existing.status,
        item.status,
      );
      const body =
        item.appendBody && !existing.body.includes(item.appendBody)
          ? `${existing.body}\n\n${item.appendBody}`
          : existing.body;
      rec = updateRecord(projectPath, existing.id, {
        body,
        ...(status !== undefined ? { status } : {}),
      });
    }
  }

  db.update(scribeSuggestions)
    .set({ status: "accepted" })
    .where(eq(scribeSuggestions.id, suggestionId))
    .run();
  return rec;
}

export function dismissSuggestion(
  projectPath: string,
  suggestionId: string,
): boolean {
  const db = getNotebookDb(projectPath);
  const row = db
    .select()
    .from(scribeSuggestions)
    .where(eq(scribeSuggestions.id, suggestionId))
    .get();
  if (!row || row.status !== "pending") return false;
  db.update(scribeSuggestions)
    .set({ status: "dismissed" })
    .where(eq(scribeSuggestions.id, suggestionId))
    .run();
  return true;
}

export function listPendingSuggestions(projectPath: string) {
  return getNotebookDb(projectPath)
    .select()
    .from(scribeSuggestions)
    .all()
    .filter((s) => s.status === "pending")
    .map((s) => ({
      id: s.id,
      batchId: s.batchId,
      action: s.action,
      payload: JSON.parse(s.payload) as unknown,
      createdAt: s.createdAt,
    }));
}

/** Fire-and-forget after a reply; never throws to callers. */
export function scheduleScribe(input: ScribeRunInput): void {
  void runScribe(input).catch(() => undefined);
}
