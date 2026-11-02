import "server-only";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { BenchReport, EvalDoc, EvalsApiResponse } from "@/lib/evals-types";

export type {
  BenchConfigId,
  BenchItemResult,
  BenchReport,
  BenchSetId,
  BenchTableRow,
  EvalDoc,
  EvalsApiResponse,
} from "@/lib/evals-types";

const FIXTURE_NAME = "bench-fixture.json";
const DOC_BASES = ["scribe", "gate", "probe"] as const;

function resultsDir(root = process.cwd()): string {
  return path.join(root, "evals", "results");
}

function safeReadJson(file: string): unknown | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function safeReadText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function isBenchReport(value: unknown): value is BenchReport {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.generatedAt === "string" &&
    o.tables != null &&
    typeof o.tables === "object" &&
    Array.isArray(o.items) &&
    Array.isArray(o.findings)
  );
}

/** Prefer latest dated `bench-YYYY-MM-DD.json`; fall back to fixture. */
export function listBenchJsonFiles(root = process.cwd()): string[] {
  const dir = resultsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^bench-.+\.json$/i.test(f))
    .sort();
}

export function loadFixtureReport(root = process.cwd()): BenchReport | null {
  const file = path.join(resultsDir(root), FIXTURE_NAME);
  if (!existsSync(file)) return null;
  const raw = safeReadJson(file);
  return isBenchReport(raw) ? raw : null;
}

export function loadLatestBenchReport(root = process.cwd()): {
  report: BenchReport | null;
  source: "dated" | "fixture" | null;
  path: string | null;
} {
  const dir = resultsDir(root);
  const files = listBenchJsonFiles(root);
  const dated = files
    .filter(
      (f) => f !== FIXTURE_NAME && /^bench-\d{4}-\d{2}-\d{2}\.json$/i.test(f),
    )
    .sort();
  const latestDated = dated.length ? dated[dated.length - 1]! : null;

  if (latestDated) {
    const full = path.join(dir, latestDated);
    const raw = safeReadJson(full);
    if (isBenchReport(raw)) {
      return { report: raw, source: "dated", path: full };
    }
  }

  const fixturePath = path.join(dir, FIXTURE_NAME);
  if (existsSync(fixturePath)) {
    const raw = safeReadJson(fixturePath);
    if (isBenchReport(raw)) {
      return { report: raw, source: "fixture", path: fixturePath };
    }
  }

  return { report: null, source: null, path: null };
}

export function loadEvalDocs(root = process.cwd()): EvalDoc[] {
  const dir = resultsDir(root);
  const docs: EvalDoc[] = [];
  for (const name of DOC_BASES) {
    const mdPath = path.join(dir, `${name}.md`);
    const jsonPath = path.join(dir, `${name}.json`);
    const markdown = existsSync(mdPath) ? safeReadText(mdPath) : null;
    const json = existsSync(jsonPath) ? safeReadJson(jsonPath) : null;
    if (markdown != null || json != null) {
      docs.push({ name, markdown, json });
    }
  }
  return docs;
}

export function loadEvalsPayload(root = process.cwd()): EvalsApiResponse {
  const latest = loadLatestBenchReport(root);
  const fixture = loadFixtureReport(root);
  return {
    bench: latest.report,
    benchSource: latest.source,
    benchPath: latest.path,
    fixture:
      latest.source === "dated"
        ? fixture
        : latest.source === "fixture"
          ? null
          : fixture,
    docs: loadEvalDocs(root),
  };
}
