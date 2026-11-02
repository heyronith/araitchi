#!/usr/bin/env node
/**
 * Benchmark harness. Usage:
 *   pnpm bench [--dry-run] [--yes] [--sets 1,2] [--configs A,C] [--limit 5] [--repeats 3] [--budget 0.5]
 *
 * Needs OpenRouter key for live runs. CI uses --dry-run (no network).
 * Live runs print an estimated cost and require confirmation unless --yes.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
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
const yes = process.argv.includes("--yes");
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
  : { bench: { budgetCapUsd: 0.5, repeats: 3 } };

const budgetCap = budget ?? defaults.bench?.budgetCapUsd ?? 0.5;
const rep = repeats ?? defaults.bench?.repeats ?? 3;

function countItems(setId) {
  const map = {
    1: "evals/bench/verifiable/items.json",
    2: "evals/bench/literature/items.json",
    3: "evals/bench/rediscovery/items.json",
    4: "evals/bench/validation/items.json",
  };
  const file = path.join(root, map[setId]);
  if (!existsSync(file)) return limit ?? 0;
  const arr = JSON.parse(readFileSync(file, "utf8"));
  const n = Array.isArray(arr) ? arr.length : 0;
  return limit != null ? Math.min(limit, n) : n;
}

let estItems = 0;
for (const s of sets) {
  const n = countItems(s);
  for (const c of configs) {
    if (s === "4" && c !== "C" && c !== "D") continue;
    estItems += n * rep;
  }
}
const estimate = estItems * budgetCap;
console.log(
  `Bench plan: sets=${sets.join(",")} configs=${configs.join(",")} limit=${limit ?? "all"} repeats=${rep}`,
);
console.log(
  `Estimated upper cost ≈ $${estimate.toFixed(2)} (cap $${budgetCap}/item × ${estItems} runs). dryRun=${dryRun}`,
);

async function confirm() {
  if (dryRun || yes) return true;
  if (!process.stdin.isTTY) {
    console.error("Live bench requires --yes when stdin is not a TTY.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(
      `Proceed with live OpenRouter spend up to ~$${estimate.toFixed(2)}? [y/N] `,
      resolve,
    );
  });
  rl.close();
  return /^y(es)?$/i.test(String(answer).trim());
}

const ok = await confirm();
if (!ok) {
  console.error("Aborted.");
  process.exit(1);
}

const runner = path.join(root, "scripts/bench-run.ts");
const forward = [
  ...(dryRun ? ["--dry-run"] : []),
  ...(yes ? ["--yes"] : []),
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
