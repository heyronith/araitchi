/**
 * Offline fixture validation (schema, duplicates, sources).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type FixtureIssue = { set: string; id?: string; message: string };

export type FixtureValidation = {
  ok: boolean;
  issues: FixtureIssue[];
  counts: Record<string, number>;
};

function loadArr(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

export function validateBenchFixturesOffline(
  root = process.cwd(),
): FixtureValidation {
  const issues: FixtureIssue[] = [];
  const counts: Record<string, number> = {};
  const questions = new Set<string>();

  const sets: Array<{
    id: string;
    file: string;
    expect: number;
    require: string[];
  }> = [
    {
      id: "1",
      file: "evals/bench/verifiable/items.json",
      expect: 40,
      require: ["id", "question", "checker", "expected", "source"],
    },
    {
      id: "2",
      file: "evals/bench/literature/items.json",
      expect: 30,
      require: ["id", "question", "goldDois", "yearTo", "source"],
    },
    {
      id: "3",
      file: "evals/bench/rediscovery/items.json",
      expect: 15,
      require: [
        "id",
        "goldStatement",
        "requiredTerms",
        "yearTo",
        "source",
        "verified",
      ],
    },
    {
      id: "4",
      file: "evals/bench/validation/items.json",
      expect: 10,
      require: [
        "id",
        "hypothesis",
        "expectedVerdict",
        "resultsFile",
        "predictions",
        "source",
      ],
    },
  ];

  for (const s of sets) {
    const items = loadArr(path.join(root, s.file));
    counts[s.id] = items.length;
    if (items.length !== s.expect) {
      issues.push({
        set: s.id,
        message: `expected ${s.expect} items, got ${items.length}`,
      });
    }
    for (const item of items) {
      const id = String(item.id ?? "?");
      for (const key of s.require) {
        if (item[key] == null) {
          issues.push({ set: s.id, id, message: `missing ${key}` });
        }
      }
      if (!item.source || typeof item.source !== "object") {
        issues.push({ set: s.id, id, message: "source must be an object" });
      } else {
        const src = item.source as Record<string, unknown>;
        if (!src.doi && !src.openalexId && !src.url && !src.arxivId) {
          issues.push({
            set: s.id,
            id,
            message: "source needs doi/openalexId/url/arxivId",
          });
        }
      }
      const q = String(
        item.question ?? item.hypothesis ?? item.goldStatement ?? "",
      );
      if (q) {
        const key = q.toLowerCase().trim();
        if (questions.has(key)) {
          issues.push({
            set: s.id,
            id,
            message: `duplicate question: ${q.slice(0, 80)}`,
          });
        }
        questions.add(key);
      }
      if (s.id === "2") {
        const gold = item.goldDois as unknown;
        if (!Array.isArray(gold) || gold.length < 1) {
          issues.push({ set: s.id, id, message: "goldDois empty" });
        }
      }
      if (s.id === "3" && typeof item.verified !== "boolean") {
        issues.push({ set: s.id, id, message: "verified must be boolean" });
      }
      if (s.id === "4") {
        const rf = String(item.resultsFile ?? "");
        if (rf && !existsSync(path.join(root, rf))) {
          issues.push({ set: s.id, id, message: `missing results file ${rf}` });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues, counts };
}
