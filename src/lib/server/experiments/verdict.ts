import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { execGit } from "@/lib/server/tools/repo/git";
import { detectRepoPath } from "@/lib/server/tools/repo/tools";

import { evaluatePrediction, expectedDescription } from "./predictions";
import {
  RESULTS_MAX_BYTES,
  resultsFileSchema,
  type ExperimentRow,
  type PredictionEval,
  type ResultsFile,
  type Verdict,
  type VerdictEvidence,
} from "./types";

export type CheckResultsInput = {
  projectPath: string;
  experiment: ExperimentRow;
  /** Injected results for unit tests (skips git/fs). */
  injectedResults?: {
    raw: string;
    commitSha?: string | null;
    filePath?: string;
    commits?: { sha: string; dateSec: number; message: string }[];
  };
};

export type CheckResultsOutput = {
  verdict: Verdict;
  evidence: VerdictEvidence;
};

function inconclusive(
  reasons: string[],
  partial: Partial<VerdictEvidence>,
): CheckResultsOutput {
  return {
    verdict: "inconclusive",
    evidence: {
      commitSha: partial.commitSha ?? null,
      filePath: partial.filePath ?? "",
      reasons,
      predictions: partial.predictions ?? [],
      preLockCommits: partial.preLockCommits ?? [],
      runCount: partial.runCount ?? 0,
      requiredRuns: partial.requiredRuns ?? 0,
      checkedAt: Date.now(),
    },
  };
}

async function findExperimentCommits(
  repoPath: string,
  experimentId: string,
  afterSec: number | null,
): Promise<{ sha: string; dateSec: number; message: string }[]> {
  const args = [
    "log",
    "--all",
    `--grep=${experimentId}`,
    "--format=%H%x09%ct%x09%s",
  ];
  if (afterSec != null) {
    args.push(`--after=${afterSec}`);
  }
  const res = await execGit(repoPath, args);
  if (!res.ok) return [];
  return res.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, date, ...rest] = line.split("\t");
      return {
        sha: sha ?? "",
        dateSec: Number(date) || 0,
        message: rest.join("\t"),
      };
    })
    .filter((c) => c.sha);
}

/**
 * Deterministic verdict from results.json. Never calls an LLM.
 */
export async function checkExperimentResults(
  input: CheckResultsInput,
): Promise<CheckResultsOutput> {
  const exp = input.experiment;
  const filePath = exp.resultsPath;
  const requiredRuns = exp.requiredRuns;

  let raw: string;
  let commitSha: string | null = null;
  let commits: { sha: string; dateSec: number; message: string }[] = [];

  if (input.injectedResults) {
    raw = input.injectedResults.raw;
    commitSha = input.injectedResults.commitSha ?? null;
    commits = input.injectedResults.commits ?? [];
  } else {
    const repoPath = detectRepoPath(input.projectPath);
    if (!repoPath) {
      return inconclusive(["No git repository detected for this project"], {
        filePath,
        requiredRuns,
      });
    }

    const afterSec = exp.lockedAt ? Math.floor(exp.lockedAt / 1000) : null;
    commits = await findExperimentCommits(repoPath, exp.id, null);
    const preLock = commits.filter(
      (c) => afterSec != null && c.dateSec < afterSec,
    );
    const postLock = commits.filter(
      (c) => afterSec == null || c.dateSec >= afterSec,
    );

    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(repoPath, filePath);

    if (!existsSync(abs)) {
      return inconclusive(
        [
          `Results file not found at ${filePath}`,
          postLock.length
            ? `Found ${postLock.length} post-lock commit(s) mentioning ${exp.id}`
            : `No post-lock commits mentioning ${exp.id}`,
        ],
        {
          filePath,
          requiredRuns,
          preLockCommits: preLock.map((c) => c.sha),
          commitSha: postLock[0]?.sha ?? null,
        },
      );
    }

    const st = statSync(abs);
    if (st.size > RESULTS_MAX_BYTES) {
      return inconclusive(
        [
          `Results file exceeds ${RESULTS_MAX_BYTES} byte limit (${st.size} bytes)`,
        ],
        { filePath, requiredRuns },
      );
    }

    raw = readFileSync(abs, "utf8");
    const head = await execGit(repoPath, ["rev-parse", "HEAD"]);
    commitSha = head.ok ? head.stdout.trim() : (postLock[0]?.sha ?? null);

    if (preLock.length) {
      // Flag but continue — may still be inconclusive for other reasons
    }
  }

  if (Buffer.byteLength(raw, "utf8") > RESULTS_MAX_BYTES) {
    return inconclusive(
      [`Results payload exceeds ${RESULTS_MAX_BYTES} byte limit`],
      { filePath, requiredRuns, commitSha },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return inconclusive(["Results JSON is not valid JSON"], {
      filePath,
      requiredRuns,
      commitSha,
    });
  }

  const parsed = resultsFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return inconclusive(
      [
        `Results schema validation failed: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => i.message)
          .join("; ")}`,
      ],
      { filePath, requiredRuns, commitSha },
    );
  }

  const results: ResultsFile = parsed.data;
  if (results.experimentId !== exp.id) {
    return inconclusive(
      [
        `experimentId mismatch: file has ${results.experimentId}, expected ${exp.id}`,
      ],
      { filePath, requiredRuns, commitSha },
    );
  }
  if (!exp.lockHash || results.lockHash !== exp.lockHash) {
    return inconclusive(
      [
        `lockHash mismatch: file has ${results.lockHash}, expected ${exp.lockHash ?? "(none)"}`,
      ],
      { filePath, requiredRuns, commitSha },
    );
  }

  const afterSec = exp.lockedAt ? Math.floor(exp.lockedAt / 1000) : null;
  const preLockCommits = commits
    .filter((c) => afterSec != null && c.dateSec < afterSec)
    .map((c) => c.sha);

  if (results.runs.length < requiredRuns) {
    return inconclusive(
      [`Too few runs: got ${results.runs.length}, required ${requiredRuns}`],
      {
        filePath,
        requiredRuns,
        commitSha,
        runCount: results.runs.length,
        preLockCommits,
      },
    );
  }

  const predictionEvals: PredictionEval[] = [];
  let anyFail = false;
  let anyMissing = false;

  for (const pred of exp.predictions) {
    const ev = evaluatePrediction(pred, results.runs);
    predictionEvals.push({
      predictionId: pred.id,
      metric: pred.metric,
      observed: ev.observed,
      expected: expectedDescription(pred),
      pass: ev.pass,
      detail: ev.detail,
    });
    if (ev.pass === null) anyMissing = true;
    else if (ev.pass === false) anyFail = true;
  }

  if (anyMissing) {
    return inconclusive(
      [
        "Missing metrics or incomplete prediction evaluation",
        ...predictionEvals.filter((p) => p.pass === null).map((p) => p.detail),
      ],
      {
        filePath,
        requiredRuns,
        commitSha,
        runCount: results.runs.length,
        predictions: predictionEvals,
        preLockCommits,
      },
    );
  }

  const verdict: Verdict = anyFail ? "refuted" : "supported";
  const reasons: string[] =
    verdict === "supported"
      ? ["All predictions passed"]
      : [
          "One or more predictions failed",
          ...predictionEvals
            .filter((p) => p.pass === false)
            .map((p) => `${p.predictionId}: ${p.detail}`),
        ];
  if (preLockCommits.length) {
    reasons.push(
      `Flagged ${preLockCommits.length} commit(s) mentioning ${exp.id} dated before lock`,
    );
  }
  return {
    verdict,
    evidence: {
      commitSha,
      filePath,
      reasons,
      predictions: predictionEvals,
      preLockCommits,
      runCount: results.runs.length,
      requiredRuns,
      checkedAt: Date.now(),
    },
  };
}

/** Effective verdict after optional user override. */
export function effectiveVerdict(exp: ExperimentRow): Verdict | null {
  return exp.overrideVerdict ?? exp.verdict;
}
