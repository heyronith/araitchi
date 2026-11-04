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

export type MetricWithCi = {
  rate: number;
  n: number;
  successes: number;
  ci95: [number, number];
};

/** Wilson score interval for a binomial proportion (95%). */
export function wilsonCi(
  successes: number,
  n: number,
  z = 1.96,
): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [
    Math.max(0, (centre - margin) / denom),
    Math.min(1, (centre + margin) / denom),
  ];
}

function metric(successes: number, n: number): MetricWithCi {
  return {
    rate: n ? successes / n : 1,
    n,
    successes,
    ci95: wilsonCi(successes, n),
  };
}

export function scoreCitationEval(rows: CitationEvalRow[]): {
  notFoundDetection: MetricWithCi;
  mismatchDetection: MetricWithCi;
  falsePositiveRate: MetricWithCi;
  /** Support accuracy on contradicted + correct (real) subsets. */
  supportAccuracy: MetricWithCi | null;
  n: number;
  correct: number;
  byKind: Record<string, { n: number; correct: number }>;
} {
  const fake = rows.filter((r) => r.kind === "fake");
  const mismatch = rows.filter((r) => r.kind === "mismatch");
  const real = rows.filter((r) => r.kind === "real");
  const support = rows.filter((r) => r.kind === "support");

  const notFoundDetection = metric(
    fake.filter((r) => r.got === "not_found").length,
    fake.length,
  );
  const mismatchDetection = metric(
    mismatch.filter((r) => r.got === "metadata_mismatch").length,
    mismatch.length,
  );
  const fpCount = real.filter(
    (r) => r.got !== "verified" && r.got !== "unchecked",
  ).length;
  const falsePositiveRate = metric(fpCount, real.length);

  // Contradicted must be claim_not_supported; real must stay verified/unchecked.
  const supportAccuracy =
    support.length + real.length > 0 && support.length > 0
      ? metric(
          support.filter((r) => r.got === "claim_not_supported").length +
            real.filter(
              (r) => r.got === "verified" || r.got === "unchecked",
            ).length,
          support.length + real.length,
        )
      : null;

  const byKind: Record<string, { n: number; correct: number }> = {};
  for (const r of rows) {
    byKind[r.kind] ??= { n: 0, correct: 0 };
    byKind[r.kind]!.n++;
    if (r.ok) byKind[r.kind]!.correct++;
  }

  return {
    notFoundDetection,
    mismatchDetection,
    falsePositiveRate,
    supportAccuracy,
    n: rows.length,
    correct: rows.filter((r) => r.ok).length,
    byKind,
  };
}

export function formatMetric(
  name: string,
  m: MetricWithCi,
  target: string,
): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return `| ${name} | ${pct(m.rate)} (n=${m.n}, 95% CI ${pct(m.ci95[0])}–${pct(m.ci95[1])}) | ${target} |`;
}
