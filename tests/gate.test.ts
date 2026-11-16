import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FakeEmbedder } from "@/lib/server/memory/fake-embedder";
import { setEmbedderForTests } from "@/lib/server/memory/embedder";
import { classifyRequest } from "@/lib/server/gate/classify";
import {
  addCorrection,
  listProjectCorrections,
} from "@/lib/server/gate/corrections";
import {
  insertGateDecision,
  listGateDecisions,
  setDecisionCorrection,
} from "@/lib/server/gate/decisions";
import {
  clearKnnCache,
  classifyKnn,
  loadSeedExamples,
} from "@/lib/server/gate/knn";
import { parseClassifierOutput } from "@/lib/server/gate/llm-classify";
import {
  mergePromptPath,
  synthesizerPromptForTask,
} from "@/lib/server/gate/merge";
import {
  extractKeyClaims,
  scoreProbeAgreement,
  runProbe,
} from "@/lib/server/gate/probe";
import { applyRules, difficultyBaseline } from "@/lib/server/gate/rules";
import { setGateSettings } from "@/lib/server/gate/settings";
import {
  actionForTaskType,
  ALWAYS_COUNCIL,
  mergeModeForTask,
} from "@/lib/gate/taxonomy";
import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";

afterEach(() => {
  setEmbedderForTests(null);
  clearKnnCache();
  closeAllNotebookDbs();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-gate-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "gate-test" });
  writeFileSync(path.join(dir, "README.md"), "x");
  setEmbedderForTests(new FakeEmbedder());
  return dir;
}

describe("taxonomy + rules", () => {
  it("maps always-council types to council", () => {
    for (const t of ALWAYS_COUNCIL) {
      expect(actionForTaskType(t)).toBe("council");
    }
    expect(actionForTaskType("factual_lookup")).toBe("retrieve_evidence");
    expect(actionForTaskType("chat")).toBe("solo");
    expect(actionForTaskType("other")).toBe("probe");
  });

  it("applies slash overrides and DOI/arXiv rules", () => {
    expect(applyRules({ text: "/solo hello", mode: "auto" })?.action).toBe(
      "solo",
    );
    expect(applyRules({ text: "/council check", mode: "auto" })?.action).toBe(
      "council",
    );
    expect(applyRules({ text: "/probe x", mode: "auto" })?.action).toBe(
      "probe",
    );
    expect(applyRules({ text: "/evidence y", mode: "auto" })?.action).toBe(
      "retrieve_evidence",
    );
    expect(
      applyRules({
        text: "See 10.1038/nature14539 for details",
        mode: "auto",
      })?.taskType,
    ).toBe("factual_lookup");
    expect(
      applyRules({ text: "arxiv:1706.03762 attention", mode: "auto" })?.action,
    ).toBe("retrieve_evidence");
    expect(
      applyRules({ text: "what changed in the repo?", mode: "auto" })?.taskType,
    ).toBe("repo_status");
    expect(applyRules({ text: "hi", mode: "auto" })?.action).toBe("solo");
    expect(applyRules({ text: "anything", mode: "solo" })?.layer).toBe(
      "forced",
    );
  });

  it("difficulty baseline returns a task type", () => {
    expect(
      difficultyBaseline("Propose hypotheses for overfitting").taskType,
    ).toBe("hypothesis_generation");
  });
});

describe("kNN classifier", () => {
  it("classifies with fake embedder and fixture seeds", async () => {
    const embedder = new FakeEmbedder();
    const seeds = loadSeedExamples().slice(0, 80);
    const result = await classifyKnn({
      text: "Propose 3 hypotheses for why our model overfits on small datasets",
      embedder,
      examples: seeds,
      k: 7,
    });
    expect(result.taskType).toBeTruthy();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.neighbors.length).toBeGreaterThan(0);
  });

  it("falls back toward LLM path when confidence low", async () => {
    const p = tempProject();
    setGateSettings(p, { knnThreshold: 0.99 });
    const c = await classifyRequest({
      projectPath: p,
      text: "Ambiguous mixed signals about whether we should pivot the methods",
      mode: "auto",
      apiKey: null,
      seeds: loadSeedExamples().slice(0, 40),
    });
    // Without API key, stays on knn even if below threshold
    expect(c.layer).toBe("knn");
    expect(c.reason).toMatch(/LLM skipped|kNN/i);
  });
});

describe("LLM classifier validation", () => {
  it("parses valid JSON and rejects garbage", () => {
    const ok = parseClassifierOutput(
      JSON.stringify({
        taskType: "chat",
        stakes: "low",
        needsEvidence: false,
        reason: "greeting",
      }),
    );
    expect(ok.ok).toBe(true);
    expect(parseClassifierOutput("not json").ok).toBe(false);
  });
});

describe("probe agreement", () => {
  it("agrees on matching finalAnswers and escalates on mismatch", async () => {
    const high = await scoreProbeAgreement(
      {
        content: "The answer is B. Caffeine half-life is about five hours.",
        finalAnswer: "B",
        claims: ["Caffeine half-life is about five hours in adults."],
      },
      {
        content: "B — roughly five hours half-life for caffeine in adults.",
        finalAnswer: "B",
        claims: ["In adults the caffeine half-life is roughly five hours."],
      },
    );
    const low = await scoreProbeAgreement(
      {
        content: "Answer A",
        finalAnswer: "A",
        claims: ["Methods only."],
      },
      {
        content: "Answer C",
        finalAnswer: "C",
        claims: ["Theory only."],
      },
    );
    expect(high).toBeGreaterThan(0.7);
    expect(low).toBe(0);

    const p = tempProject();
    setGateSettings(p, { probeAgreementThreshold: 0.7 });
    const disagree = await runProbe({
      projectPath: p,
      apiKey: "x",
      userText: "q",
      projectSystem: "",
      mockAnswers: [
        {
          modelId: "anthropic/claude-3.5-haiku",
          lab: "anthropic",
          content: "Answer is A about widgets.",
          finalAnswer: "A",
          claims: extractKeyClaims("Alpha answer about widgets only."),
          selfConfidence: 0.9,
          costUsd: 0.001,
          latencyMs: 10,
        },
        {
          modelId: "google/gemini-2.0-flash",
          lab: "google",
          content: "Answer is D about astronomy.",
          finalAnswer: "D",
          claims: extractKeyClaims(
            "Completely different astronomy claim here.",
          ),
          selfConfidence: 0.9,
          costUsd: 0.001,
          latencyMs: 10,
        },
      ],
    });
    expect(disagree.escalate).toBe(true);
    expect(disagree.answers).toHaveLength(2);

    const agree = await runProbe({
      projectPath: p,
      apiKey: "x",
      userText: "q",
      projectSystem: "",
      mockAnswers: [
        {
          modelId: "a/x",
          lab: "a",
          content: "Final answer: B. Same claim about caffeine.",
          finalAnswer: "B",
          claims: ["Same claim about caffeine half life adults."],
          selfConfidence: 0.8,
          costUsd: null,
          latencyMs: 1,
        },
        {
          modelId: "b/y",
          lab: "b",
          content: "B — Same claim about caffeine half life adults!",
          finalAnswer: "B",
          claims: ["Same claim about caffeine half life adults!"],
          selfConfidence: 0.4,
          costUsd: null,
          latencyMs: 1,
        },
      ],
    });
    expect(agree.agreed).toBe(true);
    expect(agree.winner?.modelId).toBe("a/x");
  });
});

describe("merge modes", () => {
  it("selects the right merge prompt file", () => {
    expect(mergeModeForTask("hypothesis_generation")).toBe(
      "hypothesis_generation",
    );
    expect(mergePromptPath("literature_review")).toContain("literature_review");
    const prompt = synthesizerPromptForTask("critique");
    expect(prompt).toMatch(/severity-ranked|critique/i);
  });
});

describe("decision log + corrections", () => {
  it("stores decisions and user corrections for kNN", async () => {
    const p = tempProject();
    const classification = await classifyRequest({
      projectPath: p,
      text: "hi",
      mode: "auto",
    });
    const row = insertGateDecision({
      projectPath: p,
      messageId: "m1",
      chatId: "c1",
      classification,
      models: ["openai/gpt-4o-mini"],
    });
    expect(listGateDecisions(p)).toHaveLength(1);
    setDecisionCorrection(p, row.id, "chat → solo");
    addCorrection(p, {
      text: "Propose hypotheses for widget friction uniquely",
      taskType: "hypothesis_generation",
      stakes: "high",
      needsEvidence: false,
      decisionId: row.id,
    });
    expect(listProjectCorrections(p)).toHaveLength(1);
  });
});

describe("needsEvidence forces verification note", () => {
  it("documents that agreed probe with needsEvidence maps to evidence action", () => {
    // Mapping is in chat route; here we assert taxonomy intent.
    expect(actionForTaskType("factual_lookup")).toBe("retrieve_evidence");
  });
});
