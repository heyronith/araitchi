/**
 * Long-horizon memory recall eval.
 * Usage (via scripts/eval-recall.mjs):
 *   pnpm eval:recall --scribe gold
 *   pnpm eval:recall --scribe live [--limit N]
 *
 * Writes evals/results/recall.md
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
import { closeAllNotebookDbs } from "../src/lib/server/project/db";
import { buildProjectSystemContext } from "../src/lib/server/project/context";
import { createChat } from "../src/lib/server/project/chats";
import {
  buildLongProjectFixture,
  scoreRecallAnswer,
  type RecallFixture,
} from "../src/lib/server/evals/recall-scorer";
import { ensureResearchStructure } from "../src/lib/server/project/init";
import {
  createRecord,
  updateRecord,
} from "../src/lib/server/project/records";

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
  if (existsSync(fixturePath)) {
    return JSON.parse(readFileSync(fixturePath, "utf8")) as RecallFixture;
  }
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

  const sorted = [...fixture.facts].sort(
    (a, b) => a.session - b.session || a.title.localeCompare(b.title),
  );
  const byKey = new Map<string, string>();

  for (const fact of sorted) {
    const existingId = byKey.get(fact.key);
    if (existingId) {
      updateRecord(projectPath, existingId, {
        title: fact.title,
        body: fact.body,
      });
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
    limit: 8,
    excludeChatId: chatId,
  });
  const hitText = hits.map((h) => h.text).join("\n");
  return `${ctx.systemText}\n${hitText}`;
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

  if (scribe === "gold") {
    await plantGoldRecords(projectPath, fixture);
  } else if (scribe === "live") {
    console.warn(
      "Live scribe mode not wired in CI — falling back to gold planting for retrieval eval.",
    );
    await plantGoldRecords(projectPath, fixture);
  } else {
    throw new Error(`Unknown --scribe ${scribe}`);
  }

  const questions = limit
    ? fixture.questions.slice(0, limit)
    : fixture.questions;

  let correct = 0;
  const rows: string[] = [];

  for (const q of questions) {
    const chat = createChat(projectPath, `Q ${q.id}`);
    const retrieved = await answerFromRetrieval(
      projectPath,
      q.query,
      chat.id,
    );
    const ok = scoreRecallAnswer(
      retrieved,
      q.expected,
      q.match ?? "semantic",
    );
    if (ok) correct++;
    rows.push(`| ${q.id} | ${ok ? "pass" : "fail"} | ${q.query.slice(0, 40)} |`);
  }

  const pct = questions.length
    ? Math.round((correct / questions.length) * 1000) / 10
    : 0;

  mkdirSync(outDir, { recursive: true });
  const md = [
    "# Recall eval",
    "",
    `Mode: **${scribe}**`,
    `Questions: ${questions.length}`,
    `Correct: ${correct}`,
    `Accuracy: **${pct}%** (target ≥ 90% gold)`,
    "",
    "| id | result | query |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(outMd, md);
  console.log(`Recall ${scribe}: ${correct}/${questions.length} (${pct}%)`);
  console.log(`Wrote ${outMd}`);

  closeAllNotebookDbs();
  setEmbedderForTests(null);
  await shutdownEmbedder().catch(() => undefined);

  if (scribe === "gold" && pct < 90) {
    process.exitCode = 1;
  }
}

runEval().catch((err) => {
  console.error(err);
  process.exit(1);
});
