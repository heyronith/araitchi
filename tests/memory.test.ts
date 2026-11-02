import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FakeEmbedder } from "@/lib/server/memory/fake-embedder";
import { setEmbedderForTests } from "@/lib/server/memory/embedder";
import {
  indexRecord,
  listEmbeddingRows,
  rebuildIndex,
} from "@/lib/server/memory/index";
import {
  acceptSuggestion,
  parseScribeOutput,
  runScribe,
  undoScribeBatch,
} from "@/lib/server/memory/scribe";
import {
  defaultStatusForCreate,
  sanitizeScribeStatus,
  scribeOutputSchema,
} from "@/lib/server/memory/scribe-schema";
import { findNearDuplicate, hybridSearch } from "@/lib/server/memory/search";
import { setMemorySettings } from "@/lib/server/memory/settings";
import {
  cosine,
  fakeEmbed,
  rrfMerge,
  textHash,
} from "@/lib/server/memory/vector";
import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { buildProjectSystemContext } from "@/lib/server/project/context";
import { ensureResearchStructure } from "@/lib/server/project/init";
import {
  createRecord,
  getRecord,
  listRecords,
  updateRecord,
} from "@/lib/server/project/records";
import { createBrokerForRequest } from "@/lib/server/tools/broker";
import { createMemoryTools } from "@/lib/server/tools/memory/tools";

afterEach(() => {
  setEmbedderForTests(null);
  closeAllNotebookDbs();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-mem-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "mem-test" });
  writeFileSync(path.join(dir, "README.md"), "x");
  setMemorySettings(dir, { embeddingModel: "fake", scribeEnabled: true });
  setEmbedderForTests(new FakeEmbedder());
  return dir;
}

describe("fake embedder", () => {
  it("is deterministic", async () => {
    const e = new FakeEmbedder();
    const a = await e.embed(["hello world"]);
    const b = await e.embed(["hello world"]);
    expect([...a[0]!]).toEqual([...b[0]!]);
    expect(cosine(a[0]!, b[0]!)).toBeCloseTo(1, 5);
  });
});

describe("vector helpers", () => {
  it("rrf merges ranks", () => {
    const merged = rrfMerge([
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
    ]);
    expect(merged[0]!.id).toBe("b");
  });

  it("textHash changes with text", () => {
    expect(textHash("a")).not.toBe(textHash("b"));
  });
});

describe("index + search", () => {
  it("re-embeds only when text changes", async () => {
    const p = tempProject();
    const rec = createRecord(p, {
      type: "note",
      title: "Alpha caffeine",
      body: "Half-life notes",
      source: "user",
    });
    await indexRecord(p, rec.id);
    const rows1 = listEmbeddingRows(p, "fake");
    expect(rows1).toHaveLength(1);
    const hash1 = rows1[0]!.textHash;

    await indexRecord(p, rec.id);
    expect(listEmbeddingRows(p, "fake")[0]!.textHash).toBe(hash1);

    updateRecord(p, rec.id, { body: "Updated half-life notes" });
    await indexRecord(p, rec.id);
    expect(listEmbeddingRows(p, "fake")[0]!.textHash).not.toBe(hash1);
  });

  it("hybrid search returns record hits", async () => {
    const p = tempProject();
    const rec = createRecord(p, {
      type: "hypothesis",
      title: "Caffeine extends wakefulness",
      body: "Dose-dependent alertness",
      status: "proposed",
      source: "user",
    });
    await indexRecord(p, rec.id);
    const { hits, vectorUsed } = await hybridSearch(p, {
      query: "caffeine wakefulness",
      limit: 5,
    });
    expect(vectorUsed).toBe(true);
    expect(hits.some((h) => h.ownerId === rec.id)).toBe(true);
  });

  it("falls back when embedder unavailable", async () => {
    const p = tempProject();
    createRecord(p, {
      type: "note",
      title: "Keyword only topic",
      body: "zebra giraffe",
      source: "user",
    });
    setEmbedderForTests({
      modelId: "fake",
      dims: 32,
      embed: async () => {
        throw new Error("unavailable");
      },
      getStatus: () => ({ state: "unavailable", reason: "test" }),
    });
    const { hits, vectorUsed } = await hybridSearch(p, {
      query: "zebra",
      limit: 5,
    });
    expect(vectorUsed).toBe(false);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("scribe", () => {
  it("validates JSON, caps at 5, repair path via parse", () => {
    const tooMany = {
      create: Array.from({ length: 8 }, (_, i) => ({
        type: "note",
        title: `T${i}`,
        body: `B${i}`,
      })),
      update: [],
    };
    // zod max(5) should fail
    const bad = scribeOutputSchema.safeParse(tooMany);
    expect(bad.success).toBe(false);

    const ok = parseScribeOutput(
      JSON.stringify({
        create: [{ type: "note", title: "A", body: "B" }],
        update: [],
      }),
    );
    expect(ok.ok).toBe(true);
  });

  it("dedupe converts create → update at cosine ≥ 0.90", async () => {
    const p = tempProject();
    const text = "Unique hypothesis about widget friction";
    const rec = createRecord(p, {
      type: "hypothesis",
      title: "Widget friction",
      body: text,
      status: "proposed",
      source: "user",
    });
    await indexRecord(p, rec.id);
    const near = await findNearDuplicate(
      p,
      "hypothesis",
      `Widget friction\n${text}`,
      0.9,
    );
    expect(near?.id).toBe(rec.id);

    const summary = await runScribe({
      projectPath: p,
      chatId: "c1",
      messageId: "m1",
      userText: "We still think widget friction matters",
      replyText: "Agreed.",
      sourceModel: "test/model",
      apiKey: "x",
      mockOutput: {
        create: [
          {
            type: "hypothesis",
            title: "Widget friction",
            body: text,
            status: "proposed",
          },
        ],
        update: [],
      },
    });
    expect(summary).toBeTruthy();
    expect(summary!.created).toHaveLength(0);
    expect(summary!.updated.some((u) => u.id === rec.id)).toBe(true);
  });

  it("respects disabled setting and never deletes", async () => {
    const p = tempProject();
    setMemorySettings(p, { scribeEnabled: false });
    const out = await runScribe({
      projectPath: p,
      chatId: "c1",
      messageId: "m1",
      userText: "hi",
      replyText: "yo",
      sourceModel: "test/model",
      apiKey: "x",
      mockOutput: {
        create: [{ type: "note", title: "N", body: "B" }],
        update: [],
      },
    });
    expect(out).toBeNull();
    expect(listRecords(p)).toHaveLength(0);
  });

  it("restricts hypothesis status changes", () => {
    expect(sanitizeScribeStatus("hypothesis", "proposed", "testing")).toBe(
      "testing",
    );
    expect(
      sanitizeScribeStatus("hypothesis", "proposed", "supported"),
    ).toBeUndefined();
    expect(
      sanitizeScribeStatus("hypothesis", "testing", "refuted"),
    ).toBeUndefined();
    expect(defaultStatusForCreate("hypothesis", "supported")).toBe("proposed");
  });

  it("undo reverts a batch", async () => {
    const p = tempProject();
    const summary = await runScribe({
      projectPath: p,
      chatId: "c1",
      messageId: "m1",
      userText: "fact",
      replyText: "ok",
      sourceModel: "test/model",
      apiKey: "x",
      mockOutput: {
        create: [{ type: "note", title: "Scribed note", body: "Durable fact" }],
        update: [],
      },
    });
    expect(listRecords(p)).toHaveLength(1);
    expect(undoScribeBatch(p, summary!.batchId)).toBe(true);
    expect(listRecords(p)).toHaveLength(0);
  });

  it("requireReview stores suggestions; accept creates record", async () => {
    const p = tempProject();
    setMemorySettings(p, { scribeRequireReview: true });
    const summary = await runScribe({
      projectPath: p,
      chatId: "c1",
      messageId: "m1",
      userText: "fact",
      replyText: "ok",
      sourceModel: "test/model",
      apiKey: "x",
      mockOutput: {
        create: [{ type: "note", title: "Pending note", body: "Needs review" }],
        update: [],
      },
    });
    expect(listRecords(p)).toHaveLength(0);
    expect(summary!.suggestions).toBe(1);
    // pull suggestion id from DB via accept path — list pending through run side effect
    const { listPendingSuggestions } =
      await import("@/lib/server/memory/scribe");
    const pending = listPendingSuggestions(p);
    expect(pending).toHaveLength(1);
    const rec = acceptSuggestion(p, pending[0]!.id);
    expect(rec?.title).toBe("Pending note");
    expect(getRecord(p, rec!.id)?.createdBy).toBe("scribe");
  });
});

describe("context package", () => {
  it("always includes brief + pinned and respects budget", async () => {
    const p = tempProject();
    setMemorySettings(p, { memoryTokens: 1200 });
    const pinned = createRecord(p, {
      type: "note",
      title: "Pinned fact",
      body: "Important",
      pinned: true,
      source: "user",
    });
    for (let i = 0; i < 30; i++) {
      createRecord(p, {
        type: "note",
        title: `Note ${i} caffeine research`,
        body: `Body ${i} `.repeat(40),
        source: "user",
      });
    }
    await rebuildIndex(p);
    const ctx = await buildProjectSystemContext(p, {
      userMessage: "caffeine research",
      chatId: "other",
    });
    expect(ctx.systemText).toContain("Project brief");
    expect(ctx.pinnedCount).toBeGreaterThanOrEqual(1);
    expect(ctx.items.some((i) => i.ownerId === pinned.id)).toBe(true);
    expect(ctx.totalTokens).toBeLessThanOrEqual(1200 + 50);
    expect(ctx.items.some((i) => i.refId.length > 0)).toBe(true);
  });
});

describe("memory tools", () => {
  it("registers and search_memory works", async () => {
    const p = tempProject();
    const rec = createRecord(p, {
      type: "hypothesis",
      title: "H1",
      body: "testing widgets",
      status: "testing",
      source: "user",
    });
    await indexRecord(p, rec.id);
    const broker = createBrokerForRequest({
      projectPath: p,
      chatId: "c1",
      messageId: "m1",
    });
    broker.registerAll(createMemoryTools());
    const names = broker.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "search_memory",
        "get_record",
        "list_hypotheses",
        "list_experiments",
        "search_library",
      ]),
    );
    const result = await broker.call(
      "search_memory",
      { query: "widgets", limit: 5 },
      { modelId: "test" },
    );
    expect(result.ok).toBe(true);
  });
});

describe("fakeEmbed similarity", () => {
  it("similar texts score higher", () => {
    const a = fakeEmbed("caffeine half life adults");
    const b = fakeEmbed("caffeine half-life in adults");
    const c = fakeEmbed("completely unrelated astronomy");
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
});
