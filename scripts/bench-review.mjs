#!/usr/bin/env node
/**
 * Review rediscovery fixtures (mark verified).
 *
 *   node scripts/bench-review.mjs --list
 *   node scripts/bench-review.mjs --accept-all-unverified
 *   node scripts/bench-review.mjs --accept id1,id2
 *   node scripts/bench-review.mjs --reject id1
 *   node scripts/bench-review.mjs          # interactive (TTY)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const file = path.join(root, "evals/bench/rediscovery/items.json");

function load() {
  if (!existsSync(file)) {
    console.error(`Missing ${file}`);
    process.exit(1);
  }
  const items = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(items)) {
    console.error("rediscovery items.json must be an array");
    process.exit(1);
  }
  return items;
}

function save(items) {
  writeFileSync(file, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

function setVerified(items, ids, value) {
  const want = new Set(
    ids
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  let n = 0;
  for (const it of items) {
    if (want.has(it.id)) {
      it.verified = value;
      n++;
    }
  }
  return n;
}

async function interactive(items) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q) =>
    new Promise((resolve) => {
      rl.question(q, (ans) =>
        resolve(
          String(ans || "")
            .trim()
            .toLowerCase(),
        ),
      );
    });
  let changed = 0;
  try {
    for (const it of items) {
      console.log("\n────────────────────────────────────────");
      console.log(`id: ${it.id}  verified=${it.verified}`);
      console.log(`yearTo: ${it.yearTo}`);
      console.log(`gold: ${it.goldStatement}`);
      console.log(`terms: ${(it.requiredTerms ?? []).join(", ")}`);
      console.log(
        `source: ${it.source?.title ?? "?"} | ${it.source?.doi ?? "?"}`,
      );
      const ans = await ask("Mark verified? [y]es / [n]o / [s]kip / [q]uit > ");
      if (ans === "q" || ans === "quit") break;
      if (ans === "s" || ans === "skip" || ans === "") continue;
      if (ans === "y" || ans === "yes") {
        it.verified = true;
        changed++;
      } else if (ans === "n" || ans === "no") {
        it.verified = false;
        changed++;
      }
    }
  } finally {
    rl.close();
  }
  if (changed) {
    save(items);
    console.log(`\nSaved ${changed} change(s) → ${file}`);
  } else {
    console.log("\nNo changes.");
  }
}

async function main() {
  const items = load();

  if (process.argv.includes("--list")) {
    console.log(`Rediscovery items (${items.length}) → ${file}`);
    for (const it of items) {
      const v = it.verified === true ? "verified" : "unverified";
      console.log(
        `${it.id}\t${v}\tyearTo=${it.yearTo}\tdoi=${it.source?.doi ?? "—"}\t${String(it.goldStatement ?? "").slice(0, 90)}`,
      );
    }
    process.exit(0);
  }

  if (process.argv.includes("--accept-all-unverified")) {
    let n = 0;
    for (const it of items) {
      if (it.verified !== true) {
        it.verified = true;
        n++;
      }
    }
    save(items);
    console.log(`Marked ${n} item(s) verified:true → ${file}`);
    process.exit(0);
  }

  const accept = arg("--accept");
  const reject = arg("--reject");
  if (accept || reject) {
    if (accept)
      console.log(`Accepted ${setVerified(items, accept, true)} item(s)`);
    if (reject)
      console.log(`Rejected ${setVerified(items, reject, false)} item(s)`);
    save(items);
    process.exit(0);
  }

  if (!process.stdin.isTTY) {
    console.error(
      "Non-interactive stdin. Use --list, --accept-all-unverified, --accept, or --reject.",
    );
    process.exit(1);
  }
  await interactive(items);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
