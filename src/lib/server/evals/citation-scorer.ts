import type { CitationStatus } from "@/lib/server/citations/types";

export type CitationEvalCase = {
  id: string;
  text: string;
  expectedStatus: CitationStatus;
  kind: "fake" | "mismatch" | "support" | "real";
};

export type CitationEvalRow = CitationEvalCase & {
  got: CitationStatus | "none";
  ok: boolean;
};

export function scoreCitationEval(rows: CitationEvalRow[]): {
  notFoundDetection: number;
  mismatchDetection: number;
  falsePositiveRate: number;
  supportAccuracy: number | null;
  n: number;
  correct: number;
} {
  const fake = rows.filter((r) => r.kind === "fake");
  const mismatch = rows.filter((r) => r.kind === "mismatch");
  const real = rows.filter((r) => r.kind === "real");
  const support = rows.filter((r) => r.kind === "support");

  const notFoundDetection = fake.length
    ? fake.filter((r) => r.got === "not_found").length / fake.length
    : 1;
  const mismatchDetection = mismatch.length
    ? mismatch.filter((r) => r.got === "metadata_mismatch").length /
      mismatch.length
    : 1;
  const falsePositiveRate = real.length
    ? real.filter((r) => r.got !== "verified" && r.got !== "unchecked").length /
      real.length
    : 0;
  const supportAccuracy = support.length
    ? support.filter((r) => r.ok).length / support.length
    : null;

  return {
    notFoundDetection,
    mismatchDetection,
    falsePositiveRate,
    supportAccuracy,
    n: rows.length,
    correct: rows.filter((r) => r.ok).length,
  };
}
