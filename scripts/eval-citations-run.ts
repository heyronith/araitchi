import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkCitations } from "../src/lib/server/citations/check";
import {
  scoreCitationEval,
  type CitationEvalRow,
} from "../src/lib/server/evals/citation-scorer";
import type { Paper } from "../src/lib/server/tools/papers/types";

type FixtureCase = {
  id: string;
  text: string;
  expectedStatus: CitationEvalRow["expectedStatus"];
  kind: CitationEvalRow["kind"];
  resolve?: {
    doi?: string;
    arxivId?: string;
    paper: Paper;
  };
  support?: "supported" | "not_supported" | "unclear";
};

async function main() {
  const live = process.argv.includes("--live");
  const root = process.cwd();
  const fixture = JSON.parse(
    readFileSync(path.join(root, "evals/citations/fixture.json"), "utf8"),
  ) as { cases: FixtureCase[] };

  const rows: CitationEvalRow[] = [];
  for (const c of fixture.cases) {
    const summary = await checkCitations(c.text, {
      skipSupport: c.kind !== "support",
      resolveOverride: live
        ? undefined
        : (cit) => {
            if (!c.resolve) return null;
            if (c.resolve.doi && cit.doi === c.resolve.doi)
              return c.resolve.paper;
            if (c.resolve.arxivId && cit.arxivId === c.resolve.arxivId)
              return c.resolve.paper;
            if (cit.kind === "free_text") return c.resolve.paper;
            return null;
          },
      checkWithModel: c.support ? async () => c.support! : undefined,
    });
    const got = summary.results[0]?.status ?? "none";
    rows.push({
      id: c.id,
      text: c.text,
      expectedStatus: c.expectedStatus,
      kind: c.kind,
      got,
      ok: got === c.expectedStatus,
    });
  }

  const scores = scoreCitationEval(rows);
  const outDir = path.join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  const payload = { live, scores, rows };
  writeFileSync(
    path.join(outDir, "citations.json"),
    JSON.stringify(payload, null, 2),
  );
  const md = [
    `# Citation eval (${live ? "live" : "fixture"})`,
    "",
    `| Metric | Value | Target |`,
    `| --- | --- | --- |`,
    `| not_found detection | ${(scores.notFoundDetection * 100).toFixed(1)}% | 100% |`,
    `| mismatch detection | ${(scores.mismatchDetection * 100).toFixed(1)}% | ≥95% |`,
    `| FP on real | ${(scores.falsePositiveRate * 100).toFixed(1)}% | ≤2% |`,
    `| support accuracy | ${scores.supportAccuracy == null ? "n/a" : `${(scores.supportAccuracy * 100).toFixed(1)}%`} | report |`,
    `| overall | ${scores.correct}/${scores.n} | — |`,
    "",
  ].join("\n");
  writeFileSync(path.join(outDir, "citations.md"), md);
  console.log(md);
  if (
    scores.notFoundDetection < 1 ||
    scores.mismatchDetection < 0.95 ||
    scores.falsePositiveRate > 0.02
  ) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
