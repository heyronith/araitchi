import type { PredictionSpec } from "./types";

export function mean(values: number[]): number {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) return (s[mid - 1]! + s[mid]!) / 2;
  return s[mid]!;
}

export function aggregateValues(
  values: number[],
  aggregate: PredictionSpec["aggregate"],
): number | number[] {
  if (aggregate === "all_runs" || aggregate === "any_run") return values;
  if (aggregate === "median") return median(values);
  return mean(values);
}

function nearlyEqual(a: number, b: number, tolerance = 0): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function compareScalar(
  observed: number,
  pred: PredictionSpec,
  baselineValue?: number,
): boolean {
  const tol = pred.tolerance ?? 0;
  switch (pred.comparator) {
    case ">":
      return observed > (pred.value as number) - tol;
    case ">=":
      return observed >= (pred.value as number) - tol;
    case "<":
      return observed < (pred.value as number) + tol;
    case "<=":
      return observed <= (pred.value as number) + tol;
    case "==":
      return nearlyEqual(observed, pred.value as number, tol);
    case "between": {
      const low = pred.low as number;
      const high = pred.high as number;
      return observed >= low - tol && observed <= high + tol;
    }
    case "improves_over": {
      if (
        typeof baselineValue !== "number" ||
        !Number.isFinite(baselineValue)
      ) {
        return false;
      }
      const minPct = pred.minImprovementPct ?? 0;
      // Higher is better by default for improves_over
      if (baselineValue === 0) {
        return observed > 0 && minPct <= 100;
      }
      const pct = ((observed - baselineValue) / Math.abs(baselineValue)) * 100;
      return pct + tol >= minPct;
    }
    default:
      return false;
  }
}

export function expectedDescription(pred: PredictionSpec): string {
  switch (pred.comparator) {
    case "between":
      return `${pred.aggregate}(${pred.metric}) between ${pred.low} and ${pred.high}`;
    case "improves_over":
      return `${pred.aggregate}(${pred.metric}) improves_over ${pred.baseline?.metric} by ≥${pred.minImprovementPct ?? 0}%`;
    default:
      return `${pred.aggregate}(${pred.metric}) ${pred.comparator} ${pred.value}${pred.tolerance != null ? ` ±${pred.tolerance}` : ""}`;
  }
}

/**
 * Evaluate one prediction over run metrics.
 * Returns pass=null when a metric is missing (caller maps to inconclusive).
 */
export function evaluatePrediction(
  pred: PredictionSpec,
  runs: { seed: number; metrics: Record<string, number> }[],
): {
  pass: boolean | null;
  observed: number | number[] | null;
  detail: string;
} {
  const values: number[] = [];
  for (const run of runs) {
    const v = run.metrics[pred.metric];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return {
        pass: null,
        observed: null,
        detail: `Missing metric "${pred.metric}" for seed ${run.seed}`,
      };
    }
    values.push(v);
  }

  let baselineValues: number[] | undefined;
  if (pred.comparator === "improves_over" && pred.baseline?.metric) {
    baselineValues = [];
    for (const run of runs) {
      const b = run.metrics[pred.baseline.metric];
      if (typeof b !== "number" || !Number.isFinite(b)) {
        return {
          pass: null,
          observed: null,
          detail: `Missing baseline metric "${pred.baseline.metric}" for seed ${run.seed}`,
        };
      }
      baselineValues.push(b);
    }
  }

  const agg = aggregateValues(values, pred.aggregate);
  const baselineAgg =
    baselineValues != null
      ? (aggregateValues(baselineValues, pred.aggregate) as number)
      : undefined;

  if (pred.aggregate === "all_runs") {
    const list = agg as number[];
    const passes = list.map((v, i) =>
      compareScalar(v, pred, baselineValues ? baselineValues[i] : undefined),
    );
    const pass = passes.every(Boolean);
    return {
      pass,
      observed: list,
      detail: pass
        ? `all ${list.length} runs passed`
        : `failed on ${passes.filter((p) => !p).length} run(s)`,
    };
  }

  if (pred.aggregate === "any_run") {
    const list = agg as number[];
    const passes = list.map((v, i) =>
      compareScalar(v, pred, baselineValues ? baselineValues[i] : undefined),
    );
    const pass = passes.some(Boolean);
    return {
      pass,
      observed: list,
      detail: pass
        ? `at least one of ${list.length} runs passed`
        : `no run passed`,
    };
  }

  const observed = agg as number;
  const pass = compareScalar(observed, pred, baselineAgg);
  return {
    pass,
    observed,
    detail: `observed ${observed}`,
  };
}
