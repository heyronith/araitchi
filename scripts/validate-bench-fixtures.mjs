#!/usr/bin/env node
/**
 * Validate bench fixtures.
 *
 *   node scripts/validate-bench-fixtures.mjs [--offline|--online]
 *
 * Offline (default): schema/required fields via src/lib/server/bench/validate-fixtures.ts
 * plus set-count stats. Online: also resolve DOIs via OpenAlex/Crossref (sampled).
 *
 * Exit non-zero on failure.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EMAIL =
  process.env.ARAITCHI_CONTACT_EMAIL?.trim() || "araitchi@example.com";
const UA = `araitchi-bench-validate/0.1.1 (mailto:${EMAIL})`;
const OPENALEX = (
  process.env.ARAITCHI_OPENALEX_BASE_URL?.trim() || "https://api.openalex.org"
).replace(/\/+$/, "");
const CROSSREF = (
  process.env.ARAITCHI_CROSSREF_BASE_URL?.trim() || "https://api.crossref.org"
).replace(/\/+$/, "");

function normalizeDoi(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  s = s.replace(/^doi:\s*/i, "");
  s = s.replace(/\s+/g, "");
  return s.startsWith("10.") ? s : null;
}

function loadJson(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
}

async function loadOfflineValidator() {
  // Prefer compiled/TS path via tsx when available; else dynamic import of .ts via vitest-less require.
  const tsPath = path.join(ROOT, "src/lib/server/bench/validate-fixtures.ts");
  const jsPath = path.join(ROOT, "src/lib/server/bench/validate-fixtures.js");
  if (existsSync(jsPath)) {
    const mod = await import(pathToFileURL(jsPath).href);
    return mod.validateBenchFixturesOffline;
  }
  // Use pnpm exec tsx to evaluate offline validation as a JSON blob
  const r = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "-e",
      `import { validateBenchFixturesOffline } from ${JSON.stringify(tsPath)};
       const v = validateBenchFixturesOffline(${JSON.stringify(ROOT)});
       process.stdout.write(JSON.stringify(v));`,
    ],
    { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || "tsx validate failed");
  }
  return () => JSON.parse(r.stdout);
}

async function resolveDoi(doi) {
  const d = normalizeDoi(doi);
  if (!d) return false;
  try {
    const p = new URLSearchParams({ mailto: EMAIL });
    const res = await fetch(
      `${OPENALEX}/works/doi:${encodeURIComponent(d)}?${p}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (res.ok) return true;
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch(`${CROSSREF}/works/${encodeURIComponent(d)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function collectDois() {
  const ids = new Set();
  const add = (d) => {
    const n = normalizeDoi(d);
    if (n) ids.add(n);
  };
  for (const it of loadJson("evals/bench/verifiable/items.json")) {
    add(it.source?.doi);
    if (it.checker === "doi") add(it.expected);
  }
  for (const it of loadJson("evals/bench/literature/items.json")) {
    add(it.source?.doi);
    for (const g of it.goldDois ?? []) add(g);
  }
  for (const it of loadJson("evals/bench/rediscovery/items.json")) {
    add(it.source?.doi);
  }
  for (const it of loadJson("evals/bench/validation/items.json")) {
    add(it.source?.doi);
  }
  return [...ids];
}

function printStats(v, online) {
  console.log("Bench fixture validation");
  console.log(
    `Counts: verifiable=${v.counts?.["1"] ?? "?"} literature=${v.counts?.["2"] ?? "?"} rediscovery=${v.counts?.["3"] ?? "?"} validation=${v.counts?.["4"] ?? "?"}`,
  );
  if (online) {
    console.log(
      `Online resolvable: ${online.resolved}/${online.checked} (${online.pct}%)`,
    );
  }
  if (v.issues?.length) {
    for (const iss of v.issues.slice(0, 30)) {
      console.error(
        `ERROR: set ${iss.set}${iss.id ? `/${iss.id}` : ""}: ${iss.message}`,
      );
    }
  }
}

async function main() {
  const online = process.argv.includes("--online");
  // default offline
  const getV = await loadOfflineValidator();
  const v = typeof getV === "function" ? getV(ROOT) : getV;
  let onlineStats = null;

  if (online) {
    const dois = collectDois().slice(0, 60);
    let resolved = 0;
    const unresolved = [];
    for (const d of dois) {
      const ok = await resolveDoi(d);
      if (ok) resolved++;
      else unresolved.push(d);
      await new Promise((r) => setTimeout(r, 120));
    }
    onlineStats = {
      checked: dois.length,
      resolved,
      pct: dois.length ? Math.round((1000 * resolved) / dois.length) / 10 : 0,
      unresolved,
    };
  }

  printStats(v, onlineStats);
  if (!v.ok) {
    console.log(`FAILED (${v.issues.length} issues)`);
    process.exit(1);
  }
  console.log("OK");
  process.exit(0);
}

// Also export a pure-JS offline fallback for environments without tsx (tests can import TS).
export function validateOfflineFallback(root = ROOT) {
  // Minimal mirror of counts/sources for environments without loading TS.
  const issues = [];
  const counts = {};
  const sets = [
    ["1", "evals/bench/verifiable/items.json", 40],
    ["2", "evals/bench/literature/items.json", 30],
    ["3", "evals/bench/rediscovery/items.json", 15],
    ["4", "evals/bench/validation/items.json", 10],
  ];
  for (const [id, rel, expect] of sets) {
    const file = path.join(root, rel);
    if (!existsSync(file)) {
      issues.push({ set: id, message: `missing ${rel}` });
      counts[id] = 0;
      continue;
    }
    const items = JSON.parse(readFileSync(file, "utf8"));
    counts[id] = Array.isArray(items) ? items.length : 0;
    if (counts[id] !== expect) {
      issues.push({
        set: id,
        message: `expected ${expect} items, got ${counts[id]}`,
      });
    }
  }
  return { ok: issues.length === 0, issues, counts };
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
