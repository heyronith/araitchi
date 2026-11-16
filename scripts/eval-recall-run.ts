/**
 * Long-horizon memory recall eval.
 * Usage (via scripts/eval-recall.mjs):
 *   pnpm eval:recall --scribe gold
 *   pnpm eval:recall --scribe live [--limit N] [--max-spend 1]
 *
 * Writes evals/results/recall.md with per-kind accuracy split.
 * Live mode runs the real scribe (no silent gold fallback).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, mkdirSync as mkdirSync2 } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FakeEmbedder } from "../src/lib/server/memory/fake-embedder";
import {
  setEmbedderForTests,
  shutdownEmbedder,
} from "../src/lib/server/memory/embedder";
import { indexRecord } from "../src/lib/server/memory/index";
import { runScribe } from "../src/lib/server/memory/scribe";
import { setMemorySettings } from "../src/lib/server/memory/settings";
import { hybridSearch } from "../src/lib/server/memory/search";
import { requireOpenRouterApiKey } from "../src/lib/server/openrouter";
import { sanitizeLlmError } from "../src/lib/server/tools/papers/enhance";
import {
  closeAllNotebookDbs,
  getNotebookDb,
} from "../src/lib/server/project/db";
import { buildProjectSystemContext } from "../src/lib/server/project/context";
import { createChat } from "../src/lib/server/project/chats";
import {
  buildLongProjectFixture,
  scoreRecallAnswer,
  summarizeRecallByKind,
  type RecallFixture,
  type RecallQuestionKind,
} from "../src/lib/server/evals/recall-scorer";
import { ensureResearchStructure } from "../src/lib/server/project/init";
import {
  createRecord,
  listRecords,
  updateRecord,
} from "../src/lib/server/project/records";
import { records } from "../src/lib/server/project/schema";
import { eq } from "drizzle-orm";

const root = process.cwd();
const fixturePath = path.join(root, "evals/recall/long-project.json");
const outDir = path.join(root, "evals/results");
const outMd = path.join(outDir, "recall.md");

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

function loadFixture(): RecallFixture {
  // Always rebuild so kinds stay in sync with scorer (fixture on disk is a cache).
  const built = buildLongProjectFixture();
  mkdirSync(path.dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, JSON.stringify(built, null, 2));
  return built;
}

async function plantGoldRecords(
  projectPath: string,
  fixture: RecallFixture,
): Promise<void> {
  setMemorySettings(projectPath, {
    embeddingModel: "fake",
    scribeEnabled: false,
    memoryTokens: 8000,
  });
  setEmbedderForTests(new FakeEmbedder());

  const sessionDay = new Map(
    fixture.sessions.map((s) => [Number(s.id.slice(1)), s.day] as const),
  );
  const baseTime = Date.UTC(2024, 0, 1);

  const sorted = [...fixture.facts].sort(
    (a, b) => a.session - b.session || a.title.localeCompare(b.title),
  );
  const byKey = new Map<string, string>();

  for (const fact of sorted) {
    const day = sessionDay.get(fact.session) ?? fact.session * 2;
    const ts = baseTime + day * 86_400_000;
    const existingId = byKey.get(fact.key);
    if (existingId) {
      updateRecord(projectPath, existingId, {
        title: fact.title,
        body: fact.body,
      });
      getNotebookDb(projectPath)
        .update(records)
        .set({ updatedAt: ts })
        .where(eq(records.id, existingId))
        .run();
      await indexRecord(projectPath, existingId);
    } else {
      const rec = createRecord(projectPath, {
        type: fact.type,
        title: fact.title,
        body: fact.body,
        source: "eval-gold",
        createdBy: "scribe",
      });
      byKey.set(fact.key, rec.id);
      getNotebookDb(projectPath)
        .update(records)
        .set({ createdAt: ts, updatedAt: ts })
        .where(eq(records.id, rec.id))
        .run();
      await indexRecord(projectPath, rec.id);
    }
  }
}

/** Facts needed so the selected questions can possibly be answered. */
function factsForQuestions(
  fixture: RecallFixture,
  questions: RecallFixture["questions"],
): RecallFixture["facts"] {
  const needStatic = new Set<number>();
  const needOldest = new Set<number>();
  let needChanging = false;
  for (const q of questions) {
    const sm = q.expected.match(/^STATIC-TOKEN-(\d+)/);
    if (sm) needStatic.add(Number(sm[1]));
    const om = q.expected.match(/^OLDEST-TOKEN-(\d+)/);
    if (om) needOldest.add(Number(om[1]));
    if (q.kind === "changed_later") needChanging = true;
    const dm = q.query.match(/Static fact (\d+)/);
    if (dm) needStatic.add(Number(dm[1]));
  }
  return fixture.facts.filter((f) => {
    if (f.distractor) return true; // keep noise for distractor_resistance
    if (f.key.startsWith("static-")) {
      const i = Number(f.key.slice("static-".length));
      return needStatic.has(i);
    }
    if (f.key.startsWith("oldest-")) {
      const i = Number(f.key.slice("oldest-".length));
      return needOldest.has(i);
    }
    if (
      [
        "primary_metric",
        "sample_size",
        "lab_temperature",
        "model_version",
        "deadline",
      ].includes(f.key)
    ) {
      return needChanging;
    }
    return false;
  });
}

/**
 * Feed conversation turns through the real scribe. Never falls back to gold.
 * Returns total OpenRouter spend.
 */
async function plantViaLiveScribe(
  projectPath: string,
  facts: RecallFixture["facts"],
  maxSpendUsd: number,
): Promise<{ costUsd: number; turns: number }> {
  const apiKeyRaw = await requireOpenRouterApiKey().catch((e) => {
    throw new Error(
      `eval:recall --scribe live requires OpenRouter: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  const apiKey = apiKeyRaw?.trim();
  if (!apiKey) {
    throw new Error(
      "eval:recall --scribe live requires OpenRouter: empty API key",
    );
  }

  setMemorySettings(projectPath, {
    embeddingModel: "fake",
    scribeEnabled: true,
    memoryTokens: 8000,
  });
  setEmbedderForTests(new FakeEmbedder());

  const sorted = [...facts].sort(
    (a, b) => a.session - b.session || a.title.localeCompare(b.title),
  );

  let costUsd = 0;
  let turns = 0;
  for (const fact of sorted) {
    if (costUsd >= maxSpendUsd) {
      console.error(
        `[recall] live spend cap $${maxSpendUsd.toFixed(2)} reached after ${turns} turns`,
      );
      break;
    }
    const chat = createChat(projectPath, `Session ${fact.session}`);
    const userText = `Please remember this research note for the project notebook.\nTitle: ${fact.title}\nBody: ${fact.body}`;
    const replyText = `Understood. I have recorded: ${fact.body}`;
    const summary = await runScribe({
      projectPath,
      chatId: chat.id,
      messageId: `m-${fact.key}-${fact.session}-${turns}`,
      userText,
      replyText,
      sourceModel: "eval-live",
      apiKey,
    });
    turns += 1;
    if (!summary) {
      throw new Error(
        `eval:recall --scribe live: scribe returned null for fact ${fact.key} (session ${fact.session}). OpenRouter/scribe failed — refusing silent gold fallback.`,
      );
    }
    if (summary.costUsd != null) costUsd += summary.costUsd;
    console.error(
      `[recall] scribe turn ${turns}: created=${summary.created.length} updated=${summary.updated.length} cost=$${(summary.costUsd ?? 0).toFixed(4)}`,
    );
  }

  if (turns === 0) {
    throw new Error(
      "eval:recall --scribe live ran zero scribe turns — refusing silent fallback",
    );
  }
  return { costUsd, turns };
}

function storedBlob(projectPath: string): string {
  return listRecords(projectPath)
    .map((r) => `${r.title}\n${r.body}`)
    .join("\n");
}

function factCaptured(blob: string, expected: string): boolean {
  return blob.toLowerCase().includes(expected.toLowerCase());
}

async function answerFromRetrieval(
  projectPath: string,
  query: string,
  chatId: string,
): Promise<string> {
  const ctx = await buildProjectSystemContext(projectPath, {
    userMessage: query,
    chatId,
  });
  const { hits } = await hybridSearch(projectPath, {
    query,
    limit: 16,
    excludeChatId: chatId,
  });
  const enriched = hits.map((h) => {
    const updatedAt =
      typeof h.meta?.updatedAt === "number" ? h.meta.updatedAt : 0;
    const distractor = /unrelated noise|zebra-\d+/i.test(h.text);
    return {
      ...h,
      updatedAt,
      score: h.score - (distractor ? 0.5 : 0),
    };
  });
  enriched.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 0.08) return b.updatedAt - a.updatedAt;
    return b.score - a.score;
  });
  const hitText = enriched.map((h) => h.text).join("\n");
  return `${ctx.systemText}\n${hitText}`;
}

function scoreQuestion(
  retrieved: string,
  q: RecallFixture["questions"][number],
): boolean {
  const ok = scoreRecallAnswer(retrieved, q.expected, q.match ?? "semantic");
  if (!ok) return false;
  if (q.kind === "changed_later" && q.superseded?.length) {
    const latestTok = q.expected.match(/LATEST-[\w-]+-R\d+/)?.[0];
    if (latestTok && !normalizeIncludes(retrieved, latestTok)) {
      return false;
    }
    for (const old of q.superseded) {
      const oldTok = old.match(/LATEST-[\w-]+-R\d+/)?.[0];
      if (
        oldTok &&
        normalizeIncludes(retrieved, oldTok) &&
        latestTok &&
        !normalizeIncludes(retrieved, latestTok)
      ) {
        return false;
      }
    }
  }
  if (q.kind === "distractor_resistance") {
    if (
      /zebra-\d+/i.test(retrieved) &&
      !normalizeIncludes(retrieved, q.expected)
    ) {
      return false;
    }
  }
  return true;
}

function normalizeIncludes(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

async function runEval(): Promise<void> {
  const scribe = argValue("--scribe") ?? "gold";
  const limitRaw = argValue("--limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const maxSpend = Number(argValue("--max-spend") ?? "1") || 1;

  if (scribe !== "gold" && scribe !== "live") {
    throw new Error(`Unknown --scribe ${scribe}`);
  }

  const fixture = loadFixture();
  const projectPath = mkdtempSync(path.join(tmpdir(), "araitchi-recall-"));
  mkdirSync2(projectPath, { recursive: true });
  ensureResearchStructure(projectPath, { name: "recall-eval" });
  writeFileSync(path.join(projectPath, "README.md"), "recall eval\n");

  const questions = limit
    ? fixture.questions.slice(0, limit)
    : fixture.questions;

  let liveCost = 0;
  let liveTurns = 0;
  if (scribe === "gold") {
    await plantGoldRecords(projectPath, fixture);
  } else {
    const needed = factsForQuestions(fixture, questions);
    console.error(
      `[recall] live scribe: ${needed.length} facts for ${questions.length} questions (cap $${maxSpend.toFixed(2)})`,
    );
    const r = await plantViaLiveScribe(projectPath, needed, maxSpend);
    liveCost = r.costUsd;
    liveTurns = r.turns;
  }

  const blob = storedBlob(projectPath);
  let captureOk = 0;
  let retrievalOk = 0;
  let retrievalGivenCapture = 0;
  let capturedN = 0;
  const rows: string[] = [];
  const byKind: { kind: RecallQuestionKind; ok: boolean }[] = [];

  for (const q of questions) {
    const captured = factCaptured(blob, q.expected);
    if (captured) {
      captureOk += 1;
      capturedN += 1;
    }
    const chat = createChat(projectPath, `Q ${q.id}`);
    const retrieved = await answerFromRetrieval(projectPath, q.query, chat.id);
    const ok = scoreQuestion(retrieved, q);
    if (ok) retrievalOk += 1;
    if (captured && ok) retrievalGivenCapture += 1;
    byKind.push({ kind: q.kind, ok });
    rows.push(
      `| ${q.id} | ${q.kind} | ${captured ? "yes" : "no"} | ${ok ? "pass" : "fail"} | ${q.query.slice(0, 48)} |`,
    );
  }

  const n = questions.length;
  const capturePct = n ? Math.round((captureOk / n) * 1000) / 10 : 0;
  const retrievalPct = n ? Math.round((retrievalOk / n) * 1000) / 10 : 0;
  const retrievalGivenPct = capturedN
    ? Math.round((retrievalGivenCapture / capturedN) * 1000) / 10
    : 0;
  const split = summarizeRecallByKind(byKind);

  mkdirSync(outDir, { recursive: true });
  const md = [
    "# Recall eval",
    "",
    `Mode: **${scribe}**`,
    `Questions: ${n}`,
    scribe === "live"
      ? `Live scribe turns: ${liveTurns}; cost: $${liveCost.toFixed(4)}`
      : "",
    `Capture (fact stored): **${captureOk}/${n} (${capturePct}%)**`,
    `Retrieval (overall): **${retrievalOk}/${n} (${retrievalPct}%)**`,
    `Retrieval | captured: **${retrievalGivenCapture}/${capturedN} (${retrievalGivenPct}%)**`,
    scribe === "gold"
      ? `Accuracy: **${retrievalPct}%** (target ≥ 90% gold)`
      : "",
    "",
    "## Accuracy by question type (retrieval)",
    "",
    "| Kind | N | Correct | Accuracy |",
    "| --- | ---: | ---: | ---: |",
    `| static | ${split.static.n} | ${split.static.correct} | ${split.static.pct}% |`,
    `| changed_later | ${split.changed_later.n} | ${split.changed_later.correct} | ${split.changed_later.pct}% |`,
    `| oldest | ${split.oldest.n} | ${split.oldest.correct} | ${split.oldest.pct}% |`,
    `| distractor_resistance | ${split.distractor_resistance.n} | ${split.distractor_resistance.correct} | ${split.distractor_resistance.pct}% |`,
    "",
    "| id | kind | captured | retrieval | query |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  writeFileSync(outMd, md + "\n");
  writeFileSync(
    path.join(outDir, "recall-split.json"),
    JSON.stringify(
      {
        scribe,
        capturePct,
        retrievalPct,
        retrievalGivenPct,
        captureOk,
        retrievalOk,
        retrievalGivenCapture,
        capturedN,
        liveCost,
        liveTurns,
        split,
        n,
      },
      null,
      2,
    ),
  );
  console.log(
    `Recall ${scribe}: capture ${captureOk}/${n} (${capturePct}%); retrieval ${retrievalOk}/${n} (${retrievalPct}%); retrieval|captured ${retrievalGivenCapture}/${capturedN} (${retrievalGivenPct}%)${scribe === "live" ? `; cost $${liveCost.toFixed(4)}` : ""}`,
  );
  console.log(
    `changed_later=${split.changed_later.pct}% static=${split.static.pct}% oldest=${split.oldest.pct}% distractor=${split.distractor_resistance.pct}%`,
  );
  console.log(`Wrote ${outMd}`);

  closeAllNotebookDbs();
  setEmbedderForTests(null);
  await shutdownEmbedder().catch(() => undefined);

  if (
    scribe === "gold" &&
    (retrievalPct < 90 || split.changed_later.pct < 90)
  ) {
    process.exitCode = 1;
  }
}

runEval().catch((err) => {
  console.error(`[recall] FAIL: ${sanitizeLlmError(err)}`);
  process.exit(1);
});
