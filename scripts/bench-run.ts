import { runBench, writeBenchReport } from "../src/lib/server/bench/runner";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sets = String(arg("--sets", "1,2,3,4"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ("1" | "2" | "3" | "4")[];
  const configs = String(arg("--configs", "A,B,C,D"))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean) as ("A" | "B" | "C" | "D")[];
  const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
  const repeats = arg("--repeats") ? Number(arg("--repeats")) : undefined;
  const budgetCapUsd = arg("--budget") ? Number(arg("--budget")) : undefined;

  const report = await runBench({
    sets,
    configs,
    limit,
    repeats,
    budgetCapUsd,
    dryRun,
  });
  const { mdPath, jsonPath } = writeBenchReport(report);
  console.log(`Wrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Items: ${report.items.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
