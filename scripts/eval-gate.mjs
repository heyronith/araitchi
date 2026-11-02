#!/usr/bin/env node
/**
 * Gate classifier eval (production embedder + LLM).
 *   pnpm eval:gate [model…] [--limit N]
 *
 * Spawns scripts/eval-gate-run.ts via tsx with server-only stub (Windows-safe).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const runner = path.join(root, "scripts/eval-gate-run.ts");
const register = pathToFileURL(
  path.join(root, "scripts/register-server-only.mjs"),
).href;

const forward = process.argv.slice(2);
const result = spawnSync(
  "pnpm",
  ["exec", "tsx", "--import", register, runner, ...forward],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      // Force real embedder unless caller set fake
      ARAITCHI_REAL_EMBEDDINGS: process.env.ARAITCHI_REAL_EMBEDDINGS ?? "1",
    },
  },
);
process.exit(result.status ?? 1);
