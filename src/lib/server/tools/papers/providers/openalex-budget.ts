import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getAppDataDir } from "@/lib/server/paths";

export type OpenAlexBudget = {
  remainingUsd: number;
  limitUsd: number;
  /** Unix ms when the daily window resets (best-effort). */
  resetAtMs: number | null;
  updatedAtMs: number;
};

export type OpenAlexMode = "full" | "reduced" | "offline";

/** Below this remaining USD, skip semantic + deep pagination. */
export const OPENALEX_REDUCED_THRESHOLD_USD = 0.05;

const DEFAULT_LIMIT_USD = 1;

let mem: OpenAlexBudget | null = null;

function budgetPath(): string {
  const dir = path.join(getAppDataDir(), "cache");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "openalex-budget.json");
}

export function loadOpenAlexBudget(): OpenAlexBudget {
  if (mem) return mem;
  const p = budgetPath();
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(
        readFileSync(p, "utf8"),
      ) as Partial<OpenAlexBudget>;
      mem = {
        remainingUsd:
          typeof raw.remainingUsd === "number"
            ? raw.remainingUsd
            : DEFAULT_LIMIT_USD,
        limitUsd:
          typeof raw.limitUsd === "number" ? raw.limitUsd : DEFAULT_LIMIT_USD,
        resetAtMs: typeof raw.resetAtMs === "number" ? raw.resetAtMs : null,
        updatedAtMs:
          typeof raw.updatedAtMs === "number" ? raw.updatedAtMs : Date.now(),
      };
      return mem;
    } catch {
      /* fall through */
    }
  }
  mem = {
    remainingUsd: DEFAULT_LIMIT_USD,
    limitUsd: DEFAULT_LIMIT_USD,
    resetAtMs: null,
    updatedAtMs: Date.now(),
  };
  return mem;
}

function persist(b: OpenAlexBudget) {
  mem = b;
  writeFileSync(budgetPath(), JSON.stringify(b, null, 2) + "\n");
}

/** Parse OpenAlex rate-limit response headers into budget state. */
export function noteOpenAlexHeaders(headers: Headers): OpenAlexBudget {
  const prev = loadOpenAlexBudget();
  const remainRaw =
    headers.get("x-ratelimit-remaining-usd") ??
    headers.get("X-RateLimit-Remaining-USD");
  const limitRaw =
    headers.get("x-ratelimit-limit-usd") ??
    headers.get("X-RateLimit-Limit-USD");
  const resetRaw =
    headers.get("x-ratelimit-reset") ?? headers.get("X-RateLimit-Reset");

  const remainingUsd =
    remainRaw != null && remainRaw !== "" && Number.isFinite(Number(remainRaw))
      ? Number(remainRaw)
      : prev.remainingUsd;
  const limitUsd =
    limitRaw != null && limitRaw !== "" && Number.isFinite(Number(limitRaw))
      ? Number(limitRaw)
      : prev.limitUsd;
  let resetAtMs = prev.resetAtMs;
  if (
    resetRaw != null &&
    resetRaw !== "" &&
    Number.isFinite(Number(resetRaw))
  ) {
    const secs = Number(resetRaw);
    // OpenAlex sends seconds-until-reset (not an epoch).
    resetAtMs = Date.now() + Math.max(0, secs) * 1000;
  }

  const next: OpenAlexBudget = {
    remainingUsd,
    limitUsd: limitUsd > 0 ? limitUsd : DEFAULT_LIMIT_USD,
    resetAtMs,
    updatedAtMs: Date.now(),
  };
  persist(next);
  return next;
}

export function getOpenAlexMode(): OpenAlexMode {
  const b = loadOpenAlexBudget();
  // If reset time has passed, assume budget refreshed until the next live header.
  if (b.resetAtMs != null && Date.now() >= b.resetAtMs && b.remainingUsd <= 0) {
    const refreshed: OpenAlexBudget = {
      ...b,
      remainingUsd: b.limitUsd || DEFAULT_LIMIT_USD,
      updatedAtMs: Date.now(),
    };
    persist(refreshed);
    return "full";
  }
  if (b.remainingUsd <= 0) return "offline";
  if (b.remainingUsd < OPENALEX_REDUCED_THRESHOLD_USD) return "reduced";
  return "full";
}

export function formatOpenAlexBudgetLine(
  b: OpenAlexBudget = loadOpenAlexBudget(),
): string {
  const rem = Math.max(0, b.remainingUsd);
  const lim = b.limitUsd > 0 ? b.limitUsd : DEFAULT_LIMIT_USD;
  return `OpenAlex: $${rem.toFixed(2)} of $${lim.toFixed(2)} left today`;
}

/** Approximate call costs (OpenAlex usage-based pricing). */
export const OA_COST_SEARCH_USD = 0.001;
export const OA_COST_SEMANTIC_USD = 0.001;
export const OA_COST_LIST_USD = 0.0001;
