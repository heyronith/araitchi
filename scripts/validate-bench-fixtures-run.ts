import { validateBenchFixturesOffline } from "../src/lib/server/bench/validate-fixtures";

const online = process.argv.includes("--online");
const result = validateBenchFixturesOffline(process.cwd());
console.log("Counts:", result.counts);
if (!result.ok) {
  console.error(`Offline validation failed (${result.issues.length} issues):`);
  for (const i of result.issues.slice(0, 40)) {
    console.error(`  [${i.set}] ${i.id ?? "-"}: ${i.message}`);
  }
  if (result.issues.length > 40) {
    console.error(`  … +${result.issues.length - 40} more`);
  }
  process.exit(1);
}
console.log("Offline validation OK");

if (online) {
  // Best-effort DOI HEAD/GET via doi.org — non-fatal summary.
  const { readFileSync } = await import("node:fs");
  const sets = [
    "evals/bench/verifiable/items.json",
    "evals/bench/literature/items.json",
    "evals/bench/rediscovery/items.json",
    "evals/bench/validation/items.json",
  ];
  let total = 0;
  let ok = 0;
  for (const f of sets) {
    const items = JSON.parse(readFileSync(f, "utf8")) as Array<{
      source?: { doi?: string };
      goldDois?: string[];
    }>;
    for (const it of items) {
      const ids = [
        ...(it.source?.doi ? [it.source.doi] : []),
        ...(it.goldDois ?? []).filter((d) => String(d).startsWith("10.")),
      ];
      for (const doi of ids.slice(0, 3)) {
        total++;
        try {
          const res = await fetch(`https://doi.org/${doi}`, {
            method: "HEAD",
            redirect: "follow",
          });
          if (res.ok || res.status === 302 || res.status === 301) ok++;
        } catch {
          // ignore
        }
      }
    }
  }
  const pct = total ? ((100 * ok) / total).toFixed(1) : "0";
  console.log(`Online spot-check: ${ok}/${total} DOIs resolved (${pct}%)`);
}
