import "server-only";

import { loadDefaults } from "@/lib/server/defaults";
import { requireOpenRouterApiKey } from "@/lib/server/openrouter";
import { getSetting } from "@/lib/server/settings";
import { getCouncilConfig } from "@/lib/server/project/settings";
import { updateRecord } from "@/lib/server/project/records";
import { execGit } from "@/lib/server/tools/repo/git";
import { detectRepoPath } from "@/lib/server/tools/repo/tools";

import { designExperimentDraft } from "./design";
import { writeExperimentArtifacts, syncVerdictIntoMemory } from "./files";
import { applyVerdictToHypotheses } from "./hypotheses";
import { generateCursorInstructions } from "./instructions";
import { interpretResults } from "./interpret";
import { computeLockHash } from "./lock";
import { defaultResultsSchema } from "./schema-default";
import {
  countPassingFamilyVersions,
  createExperiment,
  getExperiment,
  listExperiments,
  setExperimentFields,
  versionAfterLock,
} from "./store";
import type { ExperimentDraft, ExperimentRow, Verdict } from "./types";
import { checkExperimentResults } from "./verdict";

function pickModel(projectPath: string): string {
  const council = getCouncilConfig(projectPath);
  if (council.synthesizer) return council.synthesizer;
  return (
    getSetting<string>("default_model", "") ||
    getSetting<string>("default_model_id", "") ||
    loadDefaults().strongestSoloModel
  );
}

export async function designAndCreateExperiment(input: {
  projectPath: string;
  hypothesisId?: string;
  prompt?: string;
  draft?: ExperimentDraft;
  signal?: AbortSignal;
}): Promise<ExperimentRow> {
  let draft = input.draft;
  if (!draft) {
    const apiKey = await requireOpenRouterApiKey();
    if (!apiKey) throw new Error("OpenRouter API key required to design");
    draft = await designExperimentDraft({
      apiKey,
      modelId: pickModel(input.projectPath),
      projectPath: input.projectPath,
      hypothesisId: input.hypothesisId,
      prompt: input.prompt,
      signal: input.signal,
    });
  }
  if (input.hypothesisId) {
    updateRecord(input.projectPath, input.hypothesisId, {
      status: "testing",
    });
  }
  return createExperiment(input.projectPath, {
    ...draft,
    hypothesisIds: input.hypothesisId ? [input.hypothesisId] : [],
  });
}

export async function lockExperiment(
  projectPath: string,
  id: string,
): Promise<ExperimentRow> {
  const exp = getExperiment(projectPath, id);
  if (!exp) throw new Error("Experiment not found");
  if (exp.status !== "draft")
    throw new Error("Only draft experiments can lock");

  const resultsSchema = defaultResultsSchema(exp.id);
  const lockHash = computeLockHash({
    objective: exp.objective,
    protocol: exp.protocol,
    predictions: exp.predictions,
    resultsPath: exp.resultsPath,
    resultsSchema,
    requiredRuns: exp.requiredRuns,
    seeds: exp.seeds,
  });

  let head: string | null = null;
  const repoPath = detectRepoPath(projectPath);
  if (repoPath) {
    const res = await execGit(repoPath, ["rev-parse", "HEAD"]);
    if (res.ok) head = res.stdout.trim();
  }

  const locked = setExperimentFields(projectPath, id, {
    status: "locked",
    lockedAt: Date.now(),
    lockHash,
    lockRepoHead: head,
    resultsSchema,
  });
  writeExperimentArtifacts(projectPath, locked);
  return setExperimentFields(projectPath, id, { status: "awaiting_run" });
}

export function generateInstructions(
  projectPath: string,
  id: string,
): {
  experiment: ExperimentRow;
  markdown: string;
  paths: { instructionsPath: string; schemaPath: string };
} {
  const exp = getExperiment(projectPath, id);
  if (!exp) throw new Error("Experiment not found");
  if (!exp.lockHash || exp.status === "draft") {
    throw new Error("Lock predictions before generating instructions");
  }
  const paths = writeExperimentArtifacts(projectPath, exp);
  return {
    experiment: exp,
    markdown: generateCursorInstructions(exp),
    paths,
  };
}

export async function runCheckResults(input: {
  projectPath: string;
  id: string;
  skipInterpretation?: boolean;
  injectedResults?: Parameters<
    typeof checkExperimentResults
  >[0]["injectedResults"];
  signal?: AbortSignal;
}): Promise<ExperimentRow> {
  const exp = getExperiment(input.projectPath, input.id);
  if (!exp) throw new Error("Experiment not found");
  if (!exp.lockHash) throw new Error("Experiment is not locked");

  setExperimentFields(input.projectPath, input.id, { status: "checking" });

  const { verdict, evidence } = await checkExperimentResults({
    projectPath: input.projectPath,
    experiment: exp,
    injectedResults: input.injectedResults,
  });

  let interpretation: string | null = null;
  let concern = false;

  if (!input.skipInterpretation) {
    try {
      const apiKey = await requireOpenRouterApiKey();
      if (apiKey) {
        const note = await interpretResults({
          apiKey,
          modelId: pickModel(input.projectPath),
          experiment: exp,
          verdict,
          evidence,
          signal: input.signal,
        });
        // Verdict is immutable from interpretation
        interpretation = note.note;
        concern = note.concern;
      }
    } catch {
      interpretation = null;
    }
  }

  const status: ExperimentRow["status"] = verdict;
  const updated = setExperimentFields(input.projectPath, input.id, {
    status,
    verdict,
    verdictEvidence: evidence,
    interpretation,
    interpretationConcern: concern,
  });

  applyVerdictToHypotheses(input.projectPath, updated.hypothesisIds, verdict);
  syncVerdictIntoMemory(input.projectPath, updated, verdict);
  try {
    const { suggestAnalyseAfterVerdict } =
      await import("@/lib/server/plan/service");
    suggestAnalyseAfterVerdict(input.projectPath, input.id, verdict);
  } catch {
    /* plan optional */
  }

  // Replication rule: ≥2 independent passing locked versions in the family
  const passes = countPassingFamilyVersions(
    input.projectPath,
    updated.familyId,
  );
  if (passes >= 2 && (verdict === "supported" || verdict === "replicated")) {
    return setExperimentFields(input.projectPath, input.id, {
      status: "replicated",
      verdict: "replicated",
    });
  }

  return getExperiment(input.projectPath, input.id)!;
}

export function overrideVerdict(input: {
  projectPath: string;
  id: string;
  verdict: Verdict;
  reason: string;
}): ExperimentRow {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Override requires a written reason");
  if (
    !["supported", "refuted", "inconclusive", "replicated"].includes(
      input.verdict,
    )
  ) {
    throw new Error("Invalid override verdict");
  }
  const exp = getExperiment(input.projectPath, input.id);
  if (!exp) throw new Error("Experiment not found");

  const updated = setExperimentFields(input.projectPath, input.id, {
    overrideVerdict: input.verdict,
    overrideReason: reason,
    overrideAt: Date.now(),
    status:
      input.verdict === "replicated"
        ? "replicated"
        : (input.verdict as ExperimentRow["status"]),
  });
  applyVerdictToHypotheses(
    input.projectPath,
    updated.hypothesisIds,
    input.verdict,
  );
  syncVerdictIntoMemory(input.projectPath, updated, input.verdict);
  return updated;
}

export function requestReplication(
  projectPath: string,
  id: string,
  opts?: { newSeeds?: number[]; dataset?: string },
): ExperimentRow {
  const exp = getExperiment(projectPath, id);
  if (!exp) throw new Error("Experiment not found");
  const seeds =
    opts?.newSeeds ??
    exp.seeds.map((s) => s + 10_000 + Math.floor(Math.random() * 1000));
  return createExperiment(projectPath, {
    title: `${exp.title} (replication)`,
    objective: exp.objective,
    protocol: exp.protocol,
    baselines: exp.baselines,
    dataset: opts?.dataset ?? exp.dataset,
    requiredRuns: exp.requiredRuns,
    seeds,
    environmentNotes: exp.environmentNotes,
    predictions: exp.predictions,
    hypothesisIds: exp.hypothesisIds,
    familyId: exp.familyId,
    version: exp.version + 1,
    replicationOf: exp.id,
  });
}

export function editExperiment(
  projectPath: string,
  id: string,
  patch: Partial<ExperimentDraft> & { hypothesisIds?: string[] },
): ExperimentRow {
  return versionAfterLock(projectPath, id, patch);
}

export { listExperiments, getExperiment };
