import { createHash } from "node:crypto";

import type { PredictionSpec } from "./types";

/** Stable key-sorted JSON for lock hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export type LockPayload = {
  objective: string;
  protocol: string;
  predictions: PredictionSpec[];
  resultsPath: string;
  resultsSchema: Record<string, unknown>;
  requiredRuns: number;
  seeds: number[];
};

export function computeLockHash(payload: LockPayload): string {
  const body = canonicalJson({
    objective: payload.objective,
    protocol: payload.protocol,
    predictions: payload.predictions,
    resultsPath: payload.resultsPath,
    resultsSchema: payload.resultsSchema,
    requiredRuns: payload.requiredRuns,
    seeds: payload.seeds,
  });
  return createHash("sha256").update(body).digest("hex");
}
