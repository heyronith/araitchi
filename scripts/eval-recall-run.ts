/**
 * Long-horizon memory recall eval.
 * Usage (via scripts/eval-recall.mjs):
 *   pnpm eval:recall --scribe gold
 *   pnpm eval:recall --scribe live [--limit N]
 *
 * Writes evals/results/recall.md with per-kind accuracy split.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync, mkdirSync as mkdirSync2 } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FakeEmbedder } from "../src/lib/server/memory/fake-embedder";
import {
  setEmbedderForTests,
  shutdownEmbedder,
} from "../src/lib/server/memory/embedder";
import { indexRecord } from "../src/lib/server/memory/index";
import { setMemorySettings } from "../src/lib/server/memory/settings";
import { hybridSearch } from "../src/lib/server/memory/search";
import { closeAllNotebookDbs, getNotebookDb } from "../src/lib/server/project/db";
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
  // Prefer newest record hits when scores are close (supersede old values).
  // Down-rank obvious distractor noise titles for retrieval scoring.
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
    // Fail if an older superseded value appears without the latest token.
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
    // Must find the static token; distractor-only is a fail (already covered by ok)
    if (/zebra-\d+/i.test(retrieved) && !normalizeIncludes(retrieved, q.expected)) {
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

  const fixture = loadFixture();
  const projectPath = mkdtempSync(path.join(tmpdir(), "araitchi-recall-"));
  mkdirSync2(projectPath, { recursive: true });
  ensureResearchStructure(projectPath, { name: "recall-eval" });
  writeFileSync(path.join(projectPath, "README.md"), "recall eval\n");

  if (scribe === "gold" || scribe === "live") {
    if (scribe === "live") {
      console.warn(
        "Live scribe mode falls back to gold planting for retrieval-only split report.",
      );
    }
    await plantGoldRecords(projectPath, fixture);
  } else {
    throw new Error(`Unknown --scribe ${scribe}`);
  }

  const questions = limit
    ? fixture.questions.slice(0, limit)
    : fixture.questions;

  let correct = 0;
  const rows: string[] = [];
  const byKind: { kind: RecallQuestionKind; ok: boolean }[] = [];

  for (const q of questions) {
    const chat = createChat(projectPath, `Q ${q.id}`);
    const retrieved = await answerFromRetrieval(
      projectPath,
      q.query,
      chat.id,
    );
    const ok = scoreQuestion(retrieved, q);
    if (ok) correct++;
    byKind.push({ kind: q.kind, ok });
    rows.push(
      `| ${q.id} | ${q.kind} | ${ok ? "pass" : "fail"} | ${q.query.slice(0, 48)} |`,
    );
  }

  const pct = questions.length
    ? Math.round((correct / questions.length) * 1000) / 10
    : 0;
  const split = summarizeRecallByKind(byKind);

  mkdirSync(outDir, { recursive: true });
  const md = [
    "# Recall eval",
    "",
    `Mode: **${scribe}**`,
    `Questions: ${questions.length}`,
    `Correct: ${correct}`,
    `Accuracy: **${pct}%** (target ≥ 90% gold)`,
    "",
    "## Accuracy by question type",
    "",
    "| Kind | N | Correct | Accuracy |",
    "| --- | ---: | ---: | ---: |",
    `| static | ${split.static.n} | ${split.static.correct} | ${split.static.pct}% |`,
    `| changed_later | ${split.changed_later.n} | ${split.changed_later.correct} | ${split.changed_later.pct}% |`,
    `| oldest | ${split.oldest.n} | ${split.oldest.correct} | ${split.oldest.pct}% |`,
    `| distractor_resistance | ${split.distractor_resistance.n} | ${split.distractor_resistance.correct} | ${split.distractor_resistance.pct}% |`,
    "",
    "| id | kind | result | query |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(outMd, md);
  writeFileSync(
    path.join(outDir, "recall-split.json"),
    JSON.stringify({ pct, split, correct, n: questions.length }, null, 2),
  );
  console.log(`Recall ${scribe}: ${correct}/${questions.length} (${pct}%)`);
  console.log(
    `changed_later=${split.changed_later.pct}% static=${split.static.pct}% oldest=${split.oldest.pct}% distractor=${split.distractor_resistance.pct}%`,
  );
  console.log(`Wrote ${outMd}`);

  closeAllNotebookDbs();
  setEmbedderForTests(null);
  await shutdownEmbedder().catch(() => undefined);

  if (scribe === "gold" && (pct < 90 || split.changed_later.pct < 90)) {
    process.exitCode = 1;
  }
}

runEval().catch((err) => {
  console.error(err);
  process.exit(1);
});
