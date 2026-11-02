#!/usr/bin/env node
/**
 * Validate config/defaults.json against the live OpenRouter catalog.
 * Usage: pnpm doctor
 *
 * Reads OPENROUTER_API_KEY from env or .env.local (never prints the key).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultsPath = path.join(root, "config/defaults.json");

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = path.join(root, ".env.local");
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, "utf8");
    const m = text.match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function loadDefaults() {
  if (!existsSync(defaultsPath)) {
    console.error("Missing config/defaults.json");
    process.exit(1);
  }
  return JSON.parse(readFileSync(defaultsPath, "utf8"));
}

function collectModelIds(def) {
  const ids = new Set();
  for (const key of ["scribeModel", "classifierModel", "strongestSoloModel"]) {
    if (def[key]) ids.add(String(def[key]));
  }
  if (Array.isArray(def.probeModels)) {
    for (const m of def.probeModels) {
      if (m) ids.add(String(m));
    }
  }
  return [...ids];
}

const key = loadKey();
const defaults = loadDefaults();
let exitCode = 0;

const embedding = String(defaults.embeddingModel ?? "").trim();
if (!embedding) {
  console.warn("WARN: defaults.embeddingModel is empty");
  exitCode = 1;
} else {
  console.log(`OK: embedding model id set (${embedding.length} chars)`);
}

if (!key) {
  console.warn(
    "WARN: No OPENROUTER_API_KEY (env or .env.local); skipping catalog checks for LLM ids.",
  );
  process.exit(exitCode);
}

const base =
  process.env.ARAITCHI_OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const headers = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "http://127.0.0.1:3000",
  "X-Title": "Araitchi Doctor",
};

const modelsRes = await fetch(`${base}/models`, { headers });
if (!modelsRes.ok) {
  console.error(`OpenRouter /models failed (${modelsRes.status})`);
  process.exit(1);
}

const body = await modelsRes.json();
const list = body.data ?? [];
const idSet = new Set(list.map((m) => m.id).filter(Boolean));
console.log(`Catalog: ${idSet.size} models`);

for (const id of collectModelIds(defaults)) {
  if (idSet.has(id)) {
    console.log(`OK: ${id}`);
    continue;
  }
  // OpenRouter "~…/…-latest" aliases often resolve at completion time and
  // may be absent from /models even when they work (e.g. ~openai/gpt-latest).
  if (id.startsWith("~")) {
    console.log(`OK: ${id} (latest alias — resolve at call)`);
    continue;
  }
  console.warn(`WARN: ${id} not found in OpenRouter catalog`);
  exitCode = 1;
}

process.exit(exitCode);
