import "server-only";

import { desc, eq } from "drizzle-orm";

import { getNotebookDb } from "@/lib/server/project/db";
import { experiments } from "@/lib/server/project/schema";

import { defaultResultsPath, validateResultsPath } from "./results-path";
import { defaultResultsSchema } from "./schema-default";
import {
  predictionSpecSchema,
  type ExperimentDraft,
  type ExperimentRow,
  type ExperimentStatus,
  type PredictionSpec,
  type Verdict,
  type VerdictEvidence,
} from "./types";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToExperiment(row: typeof experiments.$inferSelect): ExperimentRow {
  const predictionsRaw = parseJson<unknown[]>(row.predictions, []);
  const predictions = predictionsRaw
    .map((p) => predictionSpecSchema.safeParse(p))
    .filter((r) => r.success)
    .map((r) => r.data);

  return {
    id: row.id,
    familyId: row.familyId,
    version: row.version,
    hypothesisIds: parseJson<string[]>(row.hypothesisIds, []),
    title: row.title,
    objective: row.objective,
    protocol: row.protocol,
    baselines: row.baselines,
    dataset: row.dataset,
    requiredRuns: row.requiredRuns,
    seeds: parseJson<number[]>(row.seeds, []),
    environmentNotes: row.environmentNotes,
    predictions,
    resultsPath: row.resultsPath,
    resultsSchema: parseJson<Record<string, unknown>>(row.resultsSchema, {}),
    status: row.status as ExperimentStatus,
    lockedAt: row.lockedAt,
    lockHash: row.lockHash,
    lockRepoHead: row.lockRepoHead,
    verdict: (row.verdict as Verdict | null) ?? null,
    verdictEvidence: parseJson<VerdictEvidence | null>(
      row.verdictEvidence ?? "null",
      null,
    ),
    interpretation: row.interpretation,
    interpretationConcern: Boolean(row.interpretationConcern),
    overrideVerdict: (row.overrideVerdict as Verdict | null) ?? null,
    overrideReason: row.overrideReason,
    overrideAt: row.overrideAt,
    replicationOf: row.replicationOf,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nextExperimentId(projectPath: string): string {
  const rows = getNotebookDb(projectPath).select().from(experiments).all();
  let max = 0;
  for (const r of rows) {
    const m = /^E-(\d+)/.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `E-${max + 1}`;
}

export function listExperiments(
  projectPath: string,
  opts?: { status?: ExperimentStatus; familyId?: string },
): ExperimentRow[] {
  let rows = getNotebookDb(projectPath)
    .select()
    .from(experiments)
    .orderBy(desc(experiments.updatedAt))
    .all()
    .map(rowToExperiment);
  if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
  if (opts?.familyId) {
    rows = rows.filter((r) => r.familyId === opts.familyId);
  }
  return rows;
}

export function getExperiment(
  projectPath: string,
  id: string,
): ExperimentRow | null {
  const row = getNotebookDb(projectPath)
    .select()
    .from(experiments)
    .where(eq(experiments.id, id))
    .get();
  return row ? rowToExperiment(row) : null;
}

export function createExperiment(
  projectPath: string,
  input: ExperimentDraft & {
    hypothesisIds?: string[];
    familyId?: string;
    version?: number;
    replicationOf?: string | null;
    id?: string;
  },
): ExperimentRow {
  const id = input.id ?? nextExperimentId(projectPath);
  const now = Date.now();
  const pathCheck = validateResultsPath(id, input.resultsPath);
  if (!pathCheck.ok) {
    throw new Error(pathCheck.error);
  }
  const resultsPath = pathCheck.path || defaultResultsPath(id);
  const schema = defaultResultsSchema(id);
  getNotebookDb(projectPath)
    .insert(experiments)
    .values({
      id,
      familyId: input.familyId ?? id,
      version: input.version ?? 1,
      hypothesisIds: JSON.stringify(input.hypothesisIds ?? []),
      title: input.title,
      objective: input.objective,
      protocol: input.protocol,
      baselines: input.baselines ?? "",
      dataset: input.dataset ?? "",
      requiredRuns: input.requiredRuns,
      seeds: JSON.stringify(input.seeds),
      environmentNotes: input.environmentNotes ?? "",
      predictions: JSON.stringify(input.predictions),
      resultsPath,
      resultsSchema: JSON.stringify(schema),
      status: "draft",
      lockedAt: null,
      lockHash: null,
      lockRepoHead: null,
      verdict: null,
      verdictEvidence: null,
      interpretation: null,
      interpretationConcern: false,
      overrideVerdict: null,
      overrideReason: null,
      overrideAt: null,
      replicationOf: input.replicationOf ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getExperiment(projectPath, id)!;
}

export function updateDraftExperiment(
  projectPath: string,
  id: string,
  patch: Partial<ExperimentDraft> & { hypothesisIds?: string[] },
): ExperimentRow {
  const existing = getExperiment(projectPath, id);
  if (!existing) throw new Error("Experiment not found");
  if (existing.status !== "draft") {
    throw new Error("Only draft experiments can be edited in place");
  }
  const predictions = (patch.predictions ??
    existing.predictions) as PredictionSpec[];
  let resultsPath = existing.resultsPath;
  if (patch.resultsPath !== undefined) {
    const pathCheck = validateResultsPath(id, patch.resultsPath);
    if (!pathCheck.ok) throw new Error(pathCheck.error);
    resultsPath = pathCheck.path;
  }
  const now = Date.now();
  getNotebookDb(projectPath)
    .update(experiments)
    .set({
      title: patch.title ?? existing.title,
      objective: patch.objective ?? existing.objective,
      protocol: patch.protocol ?? existing.protocol,
      baselines: patch.baselines ?? existing.baselines,
      dataset: patch.dataset ?? existing.dataset,
      requiredRuns: patch.requiredRuns ?? existing.requiredRuns,
      seeds: JSON.stringify(patch.seeds ?? existing.seeds),
      environmentNotes: patch.environmentNotes ?? existing.environmentNotes,
      predictions: JSON.stringify(predictions),
      hypothesisIds: JSON.stringify(
        patch.hypothesisIds ?? existing.hypothesisIds,
      ),
      resultsPath,
      updatedAt: now,
    })
    .where(eq(experiments.id, id))
    .run();
  return getExperiment(projectPath, id)!;
}

/**
 * Editing a locked (or later) experiment creates version n+1 as a new draft.
 */
export function versionAfterLock(
  projectPath: string,
  id: string,
  patch: Partial<ExperimentDraft> & { hypothesisIds?: string[] },
): ExperimentRow {
  const existing = getExperiment(projectPath, id);
  if (!existing) throw new Error("Experiment not found");
  if (existing.status === "draft") {
    return updateDraftExperiment(projectPath, id, patch);
  }
  const nextVersion = existing.version + 1;
  const draft = createExperiment(projectPath, {
    title: patch.title ?? existing.title,
    objective: patch.objective ?? existing.objective,
    protocol: patch.protocol ?? existing.protocol,
    baselines: patch.baselines ?? existing.baselines,
    dataset: patch.dataset ?? existing.dataset,
    requiredRuns: patch.requiredRuns ?? existing.requiredRuns,
    seeds: patch.seeds ?? existing.seeds,
    environmentNotes: patch.environmentNotes ?? existing.environmentNotes,
    predictions: patch.predictions ?? existing.predictions,
    resultsPath: undefined,
    hypothesisIds: patch.hypothesisIds ?? existing.hypothesisIds,
    familyId: existing.familyId,
    version: nextVersion,
    replicationOf: existing.replicationOf,
  });
  return draft;
}

export function setExperimentFields(
  projectPath: string,
  id: string,
  fields: Partial<{
    status: ExperimentStatus;
    lockedAt: number | null;
    lockHash: string | null;
    lockRepoHead: string | null;
    verdict: Verdict | null;
    verdictEvidence: VerdictEvidence | null;
    interpretation: string | null;
    interpretationConcern: boolean;
    overrideVerdict: Verdict | null;
    overrideReason: string | null;
    overrideAt: number | null;
    seeds: number[];
    requiredRuns: number;
    resultsPath: string;
    resultsSchema: Record<string, unknown>;
  }>,
): ExperimentRow {
  const existing = getExperiment(projectPath, id);
  if (!existing) throw new Error("Experiment not found");
  const now = Date.now();
  getNotebookDb(projectPath)
    .update(experiments)
    .set({
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.lockedAt !== undefined ? { lockedAt: fields.lockedAt } : {}),
      ...(fields.lockHash !== undefined ? { lockHash: fields.lockHash } : {}),
      ...(fields.lockRepoHead !== undefined
        ? { lockRepoHead: fields.lockRepoHead }
        : {}),
      ...(fields.verdict !== undefined ? { verdict: fields.verdict } : {}),
      ...(fields.verdictEvidence !== undefined
        ? {
            verdictEvidence: fields.verdictEvidence
              ? JSON.stringify(fields.verdictEvidence)
              : null,
          }
        : {}),
      ...(fields.interpretation !== undefined
        ? { interpretation: fields.interpretation }
        : {}),
      ...(fields.interpretationConcern !== undefined
        ? { interpretationConcern: fields.interpretationConcern }
        : {}),
      ...(fields.overrideVerdict !== undefined
        ? { overrideVerdict: fields.overrideVerdict }
        : {}),
      ...(fields.overrideReason !== undefined
        ? { overrideReason: fields.overrideReason }
        : {}),
      ...(fields.overrideAt !== undefined
        ? { overrideAt: fields.overrideAt }
        : {}),
      ...(fields.seeds !== undefined
        ? { seeds: JSON.stringify(fields.seeds) }
        : {}),
      ...(fields.requiredRuns !== undefined
        ? { requiredRuns: fields.requiredRuns }
        : {}),
      ...(fields.resultsPath !== undefined
        ? { resultsPath: fields.resultsPath }
        : {}),
      ...(fields.resultsSchema !== undefined
        ? { resultsSchema: JSON.stringify(fields.resultsSchema) }
        : {}),
      updatedAt: now,
    })
    .where(eq(experiments.id, id))
    .run();
  return getExperiment(projectPath, id)!;
}

export function countPassingFamilyVersions(
  projectPath: string,
  familyId: string,
): number {
  return listExperiments(projectPath, { familyId }).filter((e) => {
    const v = e.overrideVerdict ?? e.verdict;
    return v === "supported" || v === "replicated";
  }).length;
}
