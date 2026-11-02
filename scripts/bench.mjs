#!/usr/bin/env node
/**
 * Benchmark harness. Usage:
 *   pnpm bench [--dry-run] [--sets 1,2] [--configs A,C] [--limit 5] [--repeats 3] [--budget 0.5]
 *
 * Needs OPENROUTER_API_KEY for live runs. CI uses --dry-run (no network).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const dryRun = process.argv.includes("--dry-run");
const sets = String(arg("--sets", "1,2,3,4"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const configs = String(arg("--configs", "A,B,C,D"))
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const limit = arg("--limit", "") ? Number(arg("--limit")) : undefined;
const repeats = arg("--repeats", "") ? Number(arg("--repeats")) : undefined;
const budget = arg("--budget", "") ? Number(arg("--budget")) : undefined;

const defaultsPath = path.join(root, "config/defaults.json");
const defaults = existsSync(defaultsPath)
  ? JSON.parse(readFileSync(defaultsPath, "utf8"))
  : { bench: { budgetCapUsd: 0.5 } };

const budgetCap = budget ?? defaults.bench?.budgetCapUsd ?? 0.5;
const estItems =
  sets.length *
  configs.length *
  (limit ?? 40) *
  (repeats ?? defaults.bench?.repeats ?? 3);
console.log(
  `Bench plan: sets=${sets.join(",")} configs=${configs.join(",")} limit=${limit ?? "all"} repeats=${repeats ?? defaults.bench?.repeats ?? 3}`,
);
console.log(
  `Estimated upper cost ≈ $${(estItems * budgetCap).toFixed(2)} (cap $${budgetCap}/item). dryRun=${dryRun}`,
);

const runner = path.join(root, "scripts/bench-run.ts");
const forward = [
  ...(dryRun ? ["--dry-run"] : []),
  "--sets",
  sets.join(","),
  "--configs",
  configs.join(","),
  ...(limit != null ? ["--limit", String(limit)] : []),
  ...(repeats != null ? ["--repeats", String(repeats)] : []),
  ...(budget != null ? ["--budget", String(budget)] : []),
];

const result = spawnSync("pnpm", ["exec", "tsx", runner, ...forward], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
