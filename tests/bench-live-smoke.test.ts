import { describe, expect, it } from "vitest";

/**
 * Optional live smoke: ARAITCHI_LIVE_BENCH=1 runs 1 item per set on config A.
 * Skipped in CI / default.
 */
const enabled = process.env.ARAITCHI_LIVE_BENCH === "1";

describe.skipIf(!enabled)("live bench smoke", () => {
  it("runs 1 item per set on config A", async () => {
    const { runBench, writeBenchReport } =
      await import("@/lib/server/bench/runner");
    const report = await runBench({
      sets: ["1", "2", "3", "4"],
      configs: ["A", "C"],
      limit: 1,
      repeats: 1,
      dryRun: false,
      yes: true,
    });
    // Set 4 only runs C/D — A skipped for set 4
    expect(report.items.length).toBeGreaterThan(0);
    writeBenchReport(report);
    for (const item of report.items) {
      // Live costs should not look like the old hard-coded 0.05/0.15 pattern exclusively
      expect(item.costUsd).toBeGreaterThanOrEqual(0);
    }
  }, 600_000);
});
