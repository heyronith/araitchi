import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultResultsPath,
  schemaIssuesForEvidence,
  validateResultsPath,
} from "@/lib/server/experiments/results-path";
import { createExperiment } from "@/lib/server/experiments/store";
import { checkExperimentResults } from "@/lib/server/experiments/verdict";
import { lockExperiment } from "@/lib/server/experiments/service";
import { getExperiment } from "@/lib/server/experiments/store";
import { ensureResearchStructure } from "@/lib/server/project/init";
import { closeNotebookDb } from "@/lib/server/project/db";
import { assertSafeRepoPath } from "@/lib/server/tools/repo/paths";
import type {
  ExperimentRow,
  PredictionSpec,
} from "@/lib/server/experiments/types";
import { experimentDraftSchema } from "@/lib/server/experiments/types";

const pred: PredictionSpec = {
  id: "p1",
  metric: "score",
  comparator: ">",
  value: 0,
  aggregate: "mean",
};

const draftBase = {
  title: "Path safety",
  objective: "o",
  protocol: "p",
  baselines: "",
  dataset: "",
  requiredRuns: 1,
  seeds: [1],
  environmentNotes: "",
  predictions: [pred],
};

describe("validateResultsPath (design-time)", () => {
  const id = "E-1";

  it("defaults to experiments/<id>/results.json", () => {
    expect(validateResultsPath(id, undefined)).toEqual({
      ok: true,
      path: defaultResultsPath(id),
    });
    expect(validateResultsPath(id, "")).toEqual({
      ok: true,
      path: defaultResultsPath(id),
    });
  });

  it("rejects absolute, traversal, Windows, and denylisted names", () => {
    const bad = [
      "/etc/passwd.json",
      "../../x.json",
      "experiments/E-1/../../secret.json",
      "C:\\x.json",
      "C:/Windows/x.json",
      "..\\x.json",
      "experiments/E-1/.env.json",
      "experiments/E-2/results.json",
      "experiments/E-1/results.txt",
      "\\\\server\\share\\x.json",
    ];
    for (const p of bad) {
      const r = validateResultsPath(id, p);
      expect(r.ok, p).toBe(false);
    }
  });

  it("accepts a nested relative json under the experiment dir", () => {
    expect(validateResultsPath(id, "experiments/E-1/out/results.json")).toEqual(
      {
        ok: true,
        path: "experiments/E-1/out/results.json",
      },
    );
  });

  it("zod draft rejects absolute / traversal paths", () => {
    for (const resultsPath of ["/tmp/x.json", "../../x.json", "C:\\x.json"]) {
      const parsed = experimentDraftSchema.safeParse({
        ...draftBase,
        resultsPath,
      });
      expect(parsed.success, resultsPath).toBe(false);
    }
  });

  it("createExperiment rejects unsafe resultsPath", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "araitchi-path-"));
    ensureResearchStructure(dir, { name: "p" });
    expect(() =>
      createExperiment(dir, {
        ...draftBase,
        resultsPath: "/tmp/evil.json",
      }),
    ).toThrow(/relative|resultsPath|unsafe/i);
    closeNotebookDb(dir);
  });
});

describe("check-time path confinement", () => {
  const projects: string[] = [];
  afterEach(() => {
    for (const p of projects) closeNotebookDb(p);
    projects.length = 0;
  });

  function gitRepo(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "araitchi-path-git-"));
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "t@t"], {
      cwd: dir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "t"], {
      cwd: dir,
      stdio: "ignore",
    });
    writeFileSync(path.join(dir, "README"), "x");
    execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: dir,
      stdio: "ignore",
    });
    ensureResearchStructure(dir, { name: "git" });
    projects.push(dir);
    return dir;
  }

  it("legacy row with unsafe path → inconclusive without reading the file", async () => {
    const dir = gitRepo();
    const exp = createExperiment(dir, draftBase);
    await lockExperiment(dir, exp.id);
    const locked = getExperiment(dir, exp.id)!;
    const secret = "SECRET_CONTENTS_SHOULD_NEVER_LEAK_" + "Z".repeat(40);
    const outside = path.join(tmpdir(), `araitchi-secret-${Date.now()}.json`);
    writeFileSync(outside, JSON.stringify({ leak: secret }));

    const forged: ExperimentRow = {
      ...locked,
      resultsPath: outside,
    };
    const out = await checkExperimentResults({
      projectPath: dir,
      experiment: forged,
    });
    expect(out.verdict).toBe("inconclusive");
    expect(out.evidence.reasons.join(" ").toLowerCase()).toMatch(
      /unsafe results path/,
    );
    const blob = JSON.stringify(out);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain("SECRET_CONTENTS");
  });

  it("symlink pointing outside the repo is rejected by assertSafeRepoPath", () => {
    const dir = gitRepo();
    const outside = path.join(tmpdir(), `outside-${Date.now()}.json`);
    writeFileSync(outside, '{"x":1}');
    mkdirSync(path.join(dir, "experiments", "E-1"), { recursive: true });
    const link = path.join(dir, "experiments", "E-1", "results.json");
    try {
      symlinkSync(outside, link);
    } catch {
      // Windows without symlink privilege — skip
      return;
    }
    const res = assertSafeRepoPath(dir, "experiments/E-1/results.json");
    expect(res.ok).toBe(false);
    expect(realpathSync(outside)).toBeTruthy();
  });

  it("schema-error message does not contain file content", async () => {
    const dir = gitRepo();
    const exp = createExperiment(dir, draftBase);
    await lockExperiment(dir, exp.id);
    const locked = getExperiment(dir, exp.id)!;
    const poison = "POISON_PAYLOAD_DO_NOT_ECHO_" + "Q".repeat(80);
    const out = await checkExperimentResults({
      projectPath: dir,
      experiment: locked,
      injectedResults: {
        raw: JSON.stringify({
          experimentId: locked.id,
          lockHash: locked.lockHash,
          runs: "not-an-array-" + poison,
        }),
      },
    });
    expect(out.verdict).toBe("inconclusive");
    const joined = out.evidence.reasons.join(" ");
    expect(joined).toMatch(/schema/i);
    expect(joined).not.toContain(poison);
    expect(JSON.stringify(out)).not.toContain(poison);
  });

  it("schemaIssuesForEvidence only uses field names + short messages", () => {
    const s = schemaIssuesForEvidence([
      {
        path: ["runs", 0, "metrics"],
        message: `Expected object, received "${"LEAK".repeat(50)}"`,
      },
    ]);
    expect(s).toContain("runs.0.metrics");
    expect(s.length).toBeLessThan(200);
  });
});
