/**
 * Live (non-dry-run) bench item execution via real server pipelines.
 */
import "server-only";

import { generateText, stepCountIs, type ModelMessage } from "ai";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

import { resolveBalancedPreset } from "@/lib/server/council/presets";
import { runCouncil } from "@/lib/server/council/pipeline";
import type { CouncilConfig } from "@/lib/server/council/types";
import { loadDefaults } from "@/lib/server/defaults";
import {
  designAndCreateExperiment,
  lockExperiment,
  runCheckResults,
} from "@/lib/server/experiments/service";
import { synthesizerPromptForTask } from "@/lib/server/gate/merge";
import { resolveGate } from "@/lib/server/gate/resolve";
import type { TaskType } from "@/lib/server/gate/taxonomy";
import { getEmbedder } from "@/lib/server/memory/embedder";
import { listModels } from "@/lib/server/models";
import {
  createOpenRouterClient,
  requireOpenRouterApiKey,
} from "@/lib/server/openrouter";
import { loadPrompt } from "@/lib/server/prompts/load";
import { getNotebookDb } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";
import { createBrokerForRequest } from "@/lib/server/tools/broker";
import { registerEnabledTools } from "@/lib/server/tools/register";
import { setToolToggles } from "@/lib/server/tools/tools-settings";
import type { ToolSource } from "@/lib/server/tools/types";

import { withBenchContext } from "./context";
import type { BenchConfigId, BenchSetId } from "./runner-types";
import {
  parseStatedVerdict,
  parseTopHypotheses,
  scoreLiterature,
  scoreRediscovery,
  scoreVerifiable,
} from "./scoring";

export type LiveItemInput = {
  set: BenchSetId;
  config: BenchConfigId;
  item: Record<string, unknown>;
  budgetCapUsd: number;
  similarityThreshold: number;
  root?: string;
};

export type LiveItemResult = {
  correct: boolean;
  score: number;
  costUsd: number;
  latencyMs: number;
  borderline?: boolean;
  detail?: string;
  gateAction?: string;
  excludedFromHeadline?: boolean;
};

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-bench-"));
  ensureResearchStructure(dir, { name: "bench-item" });
  getNotebookDb(dir);
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "bench@araitchi.local"]);
  git(dir, ["config", "user.name", "Araitchi Bench"]);
  writeFileSync(path.join(dir, "README.md"), "# bench\n", "utf8");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

function extractCost(providerMeta: unknown): number {
  const cost = (
    providerMeta as { openrouter?: { usage?: { cost?: number } } } | undefined
  )?.openrouter?.usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}

function taskTypeOf(item: Record<string, unknown>, set: BenchSetId): TaskType {
  const t = item.taskType as string | undefined;
  const allowed = new Set<string>([
    "hypothesis_generation",
    "experiment_design",
    "literature_review",
    "critique",
    "results_interpretation",
    "factual_lookup",
    "chat",
    "formatting",
    "summarize_single",
    "repo_status",
    "code_help",
    "planning_admin",
    "other",
  ]);
  if (t && allowed.has(t)) return t as TaskType;
  if (set === "2") return "literature_review";
  if (set === "3") return "hypothesis_generation";
  if (set === "4") return "experiment_design";
  return "factual_lookup";
}

function questionOf(item: Record<string, unknown>): string {
  return String(item.question ?? item.hypothesis ?? item.prompt ?? "");
}

async function runSoloText(input: {
  apiKey: string;
  modelId: string;
  projectPath: string;
  userText: string;
  budgetCapUsd: number;
  evidenceMode?: boolean;
}): Promise<{ text: string; costUsd: number; sources: ToolSource[] }> {
  const openrouter = createOpenRouterClient(input.apiKey);
  const model = openrouter(input.modelId, { usage: { include: true } });
  const chatId = nanoid();
  const messageId = nanoid();
  const broker = createBrokerForRequest({
    projectPath: input.projectPath,
    chatId,
    messageId,
  });
  setToolToggles(input.projectPath, {
    papers: true,
    web: true,
    documents: false,
    repo: false,
    mcp: false,
    memory: true,
  });
  registerEnabledTools(broker, { projectPath: input.projectPath });
  const sources: ToolSource[] = [];
  broker.onToolEvent((ev) => {
    if (ev.sources?.length) sources.push(...ev.sources);
  });
  const tools = broker.getAiSdkTools({ modelId: input.modelId });
  const system = [
    input.evidenceMode
      ? loadPrompt("evidence.md")
      : "You are a careful research assistant.",
    loadPrompt("tools-policy.md"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await generateText({
    model,
    system,
    prompt: input.userText,
    tools,
    // Keep reservation small: OpenRouter account credits (separate from key
    // limit) reject high max_tokens even when the key still has headroom.
    maxOutputTokens: 512,
    stopWhen: stepCountIs(8),
    abortSignal: AbortSignal.timeout(180_000),
  });
  let cost = extractCost(await result.providerMetadata);
  for (const step of result.steps ?? []) {
    const c = extractCost(step.providerMetadata);
    if (c > 0)
      cost =
        Math.max(cost, c) === c && cost === 0 ? c : cost + (cost === 0 ? 0 : 0);
    // Prefer summing unique step costs when available
    if (c > 0 && cost < c) cost = c;
  }
  // If steps have individual costs, sum them
  const stepSum = (result.steps ?? []).reduce(
    (s, step) => s + extractCost(step.providerMetadata),
    0,
  );
  if (stepSum > 0) cost = stepSum;

  if (cost > input.budgetCapUsd) {
    throw Object.assign(new Error("over_budget"), {
      code: "OVER_BUDGET",
      cost,
    });
  }
  return { text: result.text ?? "", costUsd: cost, sources };
}

async function runCouncilText(input: {
  apiKey: string;
  projectPath: string;
  userText: string;
  budgetCapUsd: number;
  taskType: TaskType;
}): Promise<{ text: string; costUsd: number; sources: ToolSource[] }> {
  const catalog = await listModels();
  const defaults = loadDefaults();
  const preset = resolveBalancedPreset(catalog);
  const config: CouncilConfig = {
    members: preset.members.length
      ? preset.members
      : [defaults.strongestSoloModel],
    synthesizer: preset.synthesizer || defaults.scribeModel,
    maxOutputTokensPerMember: 512,
    budgetCapUsd: input.budgetCapUsd,
    memberTimeoutSec: 90,
    preset: "balanced",
  };
  const chatId = nanoid();
  const messageId = nanoid();
  const broker = createBrokerForRequest({
    projectPath: input.projectPath,
    chatId,
    messageId,
  });
  setToolToggles(input.projectPath, {
    papers: true,
    web: true,
    documents: false,
    repo: false,
    mcp: false,
    memory: true,
  });
  registerEnabledTools(broker, { projectPath: input.projectPath });
  const sources: ToolSource[] = [];
  broker.onToolEvent((ev) => {
    if (ev.sources?.length) sources.push(...ev.sources);
  });
  const modelMessages: ModelMessage[] = [
    { role: "user", content: input.userText },
  ];
  const result = await runCouncil({
    apiKey: input.apiKey,
    config,
    catalog,
    projectSystem: "",
    modelMessages,
    contextChars: input.userText.length,
    allowOverBudget: false,
    broker,
    maxSteps: 6,
    synthesizerSystem: synthesizerPromptForTask(input.taskType),
  });
  const costUsd = result.summary.totalCost ?? 0;
  if (costUsd > input.budgetCapUsd) {
    throw Object.assign(new Error("over_budget"), {
      code: "OVER_BUDGET",
      cost: costUsd,
    });
  }
  return {
    text: result.finalAnswer || "",
    costUsd,
    sources,
  };
}

async function runValidationD(input: {
  projectPath: string;
  item: Record<string, unknown>;
  root: string;
}): Promise<{
  verdict: string;
  costUsd: number;
  detail: string;
}> {
  const hypothesis = String(input.item.hypothesis ?? "");
  const designStarted = Date.now();
  const exp = await designAndCreateExperiment({
    projectPath: input.projectPath,
    prompt: hypothesis,
    signal: AbortSignal.timeout(180_000),
  });
  const locked = await lockExperiment(input.projectPath, exp.id);
  const resultsRel = String(
    input.item.resultsFile ??
      `evals/bench/validation/results/${input.item.id}.json`,
  );
  const srcPath = path.isAbsolute(resultsRel)
    ? resultsRel
    : path.join(input.root, resultsRel);
  if (!existsSync(srcPath)) {
    throw new Error(`Missing results fixture: ${srcPath}`);
  }
  const rawObj = JSON.parse(readFileSync(srcPath, "utf8")) as Record<
    string,
    unknown
  >;
  rawObj.experimentId = locked.id;
  rawObj.lockHash = locked.lockHash;
  const destDir = path.join(input.projectPath, "experiments", locked.id);
  mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, "results.json");
  writeFileSync(destFile, JSON.stringify(rawObj, null, 2) + "\n", "utf8");
  git(input.projectPath, ["add", "-A"]);
  git(input.projectPath, [
    "commit",
    "-m",
    `exp(${locked.id}): bench harness results`,
  ]);
  const checked = await runCheckResults({
    projectPath: input.projectPath,
    id: locked.id,
    skipInterpretation: true,
  });
  const verdict = String(checked.verdict ?? "inconclusive");
  // Design uses OpenRouter; we don't get exact usage here — use elapsed heuristic floor.
  const costUsd = Math.max(0.001, (Date.now() - designStarted) / 1e7);
  return {
    verdict,
    costUsd,
    detail: `lockHash=${locked.lockHash?.slice(0, 8)} verdictEngine=${verdict}`,
  };
}

export async function runLiveItem(
  input: LiveItemInput,
): Promise<LiveItemResult> {
  const started = Date.now();
  const root = input.root ?? process.cwd();
  const apiKey = await requireOpenRouterApiKey();
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY / OpenRouter secret required for live bench",
    );
  }
  const defaults = loadDefaults();
  const projectPath = makeTempProject();
  const yearTo = input.item.yearTo as number | undefined;
  const q = questionOf(input.item);
  const taskType = taskTypeOf(input.item, input.set);

  try {
    return (await withBenchContext(
      {
        yearTo,
        configId: input.config,
        budgetCapUsd: input.budgetCapUsd,
        dryRun: false,
      },
      async () => {
        let text = "";
        let costUsd = 0;
        let sources: ToolSource[] = [];
        let gateAction: string | undefined;
        let detail = "";
        let borderline = false;
        let excludedFromHeadline = false;
        let correct = false;
        let score = 0;

        try {
          if (input.set === "4" && input.config === "D") {
            const v = await runValidationD({
              projectPath,
              item: input.item,
              root,
            });
            costUsd = v.costUsd;
            detail = v.detail;
            gateAction = "auto";
            const expected = String(input.item.expectedVerdict);
            correct = v.verdict === expected;
            score = correct ? 1 : 0;
          } else if (input.set === "4" && input.config === "C") {
            const resultsRel = String(input.item.resultsFile ?? "");
            const srcPath = path.join(root, resultsRel);
            const resultsText = existsSync(srcPath)
              ? readFileSync(srcPath, "utf8")
              : "";
            const prompt = `Hypothesis:\n${String(input.item.hypothesis)}\n\nResults JSON:\n${resultsText}\n\nState the verdict as exactly one of: supported, refuted, inconclusive.`;
            const solo = await runSoloText({
              apiKey,
              modelId: defaults.strongestSoloModel,
              projectPath,
              userText: prompt,
              budgetCapUsd: input.budgetCapUsd,
            });
            text = solo.text;
            costUsd = solo.costUsd;
            sources = solo.sources;
            gateAction = "auto";
            const stated = parseStatedVerdict(text);
            const expected = String(input.item.expectedVerdict);
            correct = stated === expected;
            score = correct ? 1 : 0;
            detail = `stated=${stated} expected=${expected}`;
          } else if (input.config === "A") {
            const solo = await runSoloText({
              apiKey,
              modelId: defaults.strongestSoloModel,
              projectPath,
              userText: q,
              budgetCapUsd: input.budgetCapUsd,
              evidenceMode: input.set === "2",
            });
            text = solo.text;
            costUsd = solo.costUsd;
            sources = solo.sources;
          } else if (input.config === "B") {
            const council = await runCouncilText({
              apiKey,
              projectPath,
              userText: q,
              budgetCapUsd: input.budgetCapUsd,
              taskType,
            });
            text = council.text;
            costUsd = council.costUsd;
            sources = council.sources;
          } else {
            const gate = await resolveGate({
              projectPath,
              text: q,
              mode: "auto",
              apiKey,
            });
            gateAction = gate.action;
            if (gate.action === "council") {
              const council = await runCouncilText({
                apiKey,
                projectPath,
                userText: q,
                budgetCapUsd: input.budgetCapUsd,
                taskType: gate.taskType,
              });
              text = council.text;
              costUsd = council.costUsd;
              sources = council.sources;
            } else {
              const solo = await runSoloText({
                apiKey,
                modelId: defaults.strongestSoloModel,
                projectPath,
                userText: q,
                budgetCapUsd: input.budgetCapUsd,
                evidenceMode: gate.action === "retrieve_evidence",
              });
              text = solo.text;
              costUsd = solo.costUsd;
              sources = solo.sources;
            }
          }

          if (!(
            input.set === "4" &&
            (input.config === "C" || input.config === "D")
          )) {
            if (input.set === "1") {
              correct = scoreVerifiable(input.item, text);
              score = correct ? 1 : 0;
            } else if (input.set === "2") {
              const lit = await scoreLiterature({
                item: input.item,
                text,
                sources,
              });
              correct = lit.correct;
              score = lit.score;
              detail = lit.detail;
            } else if (input.set === "3") {
              const embedder = await getEmbedder(
                process.env.ARAITCHI_FAKE_EMBEDDINGS === "1"
                  ? "fake"
                  : undefined,
              );
              const rd = await scoreRediscovery({
                item: input.item,
                text,
                hypotheses: parseTopHypotheses(text, 3),
                embedder,
                similarityThreshold: input.similarityThreshold,
              });
              correct = rd.correct;
              score = rd.score;
              borderline = rd.borderline;
              detail = rd.detail;
              excludedFromHeadline = rd.excludedFromHeadline;
            }
          }
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === "OVER_BUDGET") {
            detail = "over_budget";
            costUsd = Math.min(
              (e as { cost?: number }).cost ?? input.budgetCapUsd,
              input.budgetCapUsd,
            );
          } else {
            detail = `error: ${e instanceof Error ? e.message : String(e)}`;
          }
          correct = false;
          score = 0;
        }

        return {
          correct,
          score,
          costUsd: Math.min(costUsd, input.budgetCapUsd),
          latencyMs: Date.now() - started,
          borderline,
          detail,
          gateAction,
          excludedFromHeadline,
        };
      },
    )) as LiveItemResult;
  } finally {
    try {
      rmSync(projectPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
