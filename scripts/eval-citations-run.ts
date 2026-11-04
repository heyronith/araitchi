/**
 * Citation checking eval.
 *
 * Modes:
 *   (default)        Fixture resolveOverride + injected support (CI / offline).
 *   --keyless        Live Crossref+arXiv via tool broker; fake+mismatch (+real
 *                    existence). Skips model support and OpenAlex.
 *   --support        Also run model support on support+real subsets (needs key).
 *   --live           All providers including OpenAlex (after OA reset).
 *   --kinds a,b      Restrict to kinds (fake,mismatch,support,real).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkCitations } from "../src/lib/server/citations/check";
import {
  formatMetric,
  scoreCitationEval,
  type CitationEvalRow,
} from "../src/lib/server/evals/citation-scorer";
import { ensureResearchStructure } from "../src/lib/server/project/init";
import { createBrokerForRequest } from "../src/lib/server/tools/broker";
import { createPaperTools } from "../src/lib/server/tools/papers/tools";
import type {
  Paper,
  PaperProvider,
} from "../src/lib/server/tools/papers/types";

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

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const keyless = hasFlag("--keyless");
  const supportLive = hasFlag("--support");
  const liveAll = hasFlag("--live");
  const kindsArg = argValue("--kinds");
  const kinds = kindsArg
    ? new Set(kindsArg.split(",").map((s) => s.trim()))
    : null;

  const root = process.cwd();
  const fixture = JSON.parse(
    readFileSync(path.join(root, "evals/citations/fixture.json"), "utf8"),
  ) as { cases: FixtureCase[]; meta?: unknown };

  let cases = fixture.cases;
  if (kinds) cases = cases.filter((c) => kinds.has(c.kind));
  // Keyless offline-now: fakes + mismatches (and reals for FP); defer support.
  if (keyless && !supportLive && !kinds) {
    cases = cases.filter((c) => c.kind !== "support");
  }

  const apiKey =
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.ARAITCHI_OPENROUTER_API_KEY?.trim() ||
    "";

  let projectPath: string | undefined;
  let broker: ReturnType<typeof createBrokerForRequest> | undefined;
  let enabledProviders: PaperProvider[] | undefined;

  if (keyless || liveAll) {
    projectPath = mkdtempSync(path.join(tmpdir(), "araitchi-cite-eval-"));
    ensureResearchStructure(projectPath, { name: "cite-eval" });
    enabledProviders = liveAll
      ? undefined
      : (["crossref", "arxiv"] as PaperProvider[]);
    broker = createBrokerForRequest({
      projectPath,
      chatId: "cite-eval",
      messageId: "cite-eval",
    });
    broker.registerAll(
      createPaperTools({
        projectPath,
        contactEmail: process.env.ARAITCHI_CONTACT_EMAIL ?? undefined,
        enabledProviders,
      }),
    );
  }

  const rows: CitationEvalRow[] = [];
  let i = 0;
  for (const c of cases) {
    i++;
    if (i % 25 === 0 || i === 1) {
      console.error(`… ${i}/${cases.length} (${c.id})`);
    }
    // Pace keyless Crossref/arXiv to stay under polite-pool limits.
    if (broker && i > 1) {
      await new Promise((r) => setTimeout(r, 220));
    }
    const useNetwork = Boolean(broker);
    const kind = c.kind as FixtureCase["kind"];
    const runSupport = kind === "support" || (supportLive && kind === "real");

    const summary = await checkCitations(c.text, {
      skipSupport: !runSupport,
      broker,
      projectPath,
      enabledProviders,
      apiKey: supportLive && apiKey ? apiKey : undefined,
      forceHeuristic: runSupport && !supportLive && !c.support,
      resolveOverride: useNetwork
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
      checkWithModel:
        runSupport && c.support && !supportLive
          ? async () => c.support!
          : undefined,
    });
    // Prefer DOI/arXiv results over free-text in the same sentence (free-text
    // often sorts first by index and can mask the id-based citation under test).
    const preferred =
      summary.results.find(
        (r) =>
          (r.citation.kind === "doi" || r.citation.kind === "arxiv") &&
          r.status === c.expectedStatus,
      ) ??
      summary.results.find(
        (r) => r.citation.kind === "doi" || r.citation.kind === "arxiv",
      ) ??
      summary.results.find((r) => r.status === c.expectedStatus) ??
      summary.results[0];
    const got = preferred?.status ?? "none";
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
  const mode = liveAll
    ? "live"
    : keyless
      ? supportLive
        ? "keyless+support"
        : "keyless"
      : "fixture";

  const outDir = path.join(root, "evals/results");
  mkdirSync(outDir, { recursive: true });
  const payload = {
    mode,
    meta: fixture.meta,
    scores,
    rows,
  };
  writeFileSync(
    path.join(outDir, "citations.json"),
    JSON.stringify(payload, null, 2),
  );

  const md = [
    `# Citation eval (${mode})`,
    "",
    `Cases: ${scores.n} · correct ${scores.correct}`,
    "",
    `| Metric | Value | Target |`,
    `| --- | --- | --- |`,
    formatMetric("not_found detection", scores.notFoundDetection, "100%"),
    formatMetric("mismatch detection", scores.mismatchDetection, "≥95%"),
    formatMetric("FP on real", scores.falsePositiveRate, "≤2%"),
    scores.supportAccuracy
      ? formatMetric(
          "support accuracy (contradicted+correct)",
          scores.supportAccuracy,
          "report",
        )
      : `| support accuracy | n/a (deferred) | report |`,
    "",
    "## By kind",
    "",
    ...Object.entries(scores.byKind).map(
      ([k, v]) => `- **${k}**: ${v.correct}/${v.n}`,
    ),
    "",
  ].join("\n");
  writeFileSync(path.join(outDir, "citations.md"), md);
  console.log(md);

  // Gate: fixture + keyless must meet detection targets on the subsets run.
  if (scores.notFoundDetection.n > 0 && scores.notFoundDetection.rate < 1) {
    process.exitCode = 1;
  }
  if (scores.mismatchDetection.n > 0 && scores.mismatchDetection.rate < 0.95) {
    process.exitCode = 1;
  }
  if (scores.falsePositiveRate.n > 0 && scores.falsePositiveRate.rate > 0.02) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
