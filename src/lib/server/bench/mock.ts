/**
 * Dry-run / CI mocks for the bench harness. Live runs must never import-call these.
 */

import type { BenchSetId } from "./runner-types";

export function mockReplyForItem(
  item: Record<string, unknown>,
  set: BenchSetId,
): string {
  if (set === "1") {
    const c = item.checker as string;
    if (c === "doi") return `The DOI is ${item.expected}`;
    if (c === "numeric") return `Answer: ${item.expected}`;
    if (c === "exact") return String(item.expected);
    if (c === "date") return String(item.expected);
  }
  if (set === "2") {
    const gold = (item.goldDois as string[]) ?? [];
    return `Sources: ${gold.join(", ")}`;
  }
  if (set === "3") {
    return String(item.goldStatement ?? "");
  }
  if (set === "4") {
    return `Verdict: ${String(item.expectedVerdict ?? "inconclusive")}`;
  }
  return "ok";
}

export function mockCostUsd(config: string, dryRun: boolean): number {
  let costUsd = dryRun ? 0.01 : 0.05;
  if (config === "B") costUsd *= 3;
  if (config === "D") costUsd *= 1.2;
  return costUsd;
}
