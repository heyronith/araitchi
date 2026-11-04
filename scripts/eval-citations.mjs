#!/usr/bin/env node
/**
 * Citation checking eval.
 *   pnpm eval:citations
 *   pnpm eval:citations --live
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const runner = path.join(root, "scripts/eval-citations-run.ts");
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
  },
);
process.exit(result.status ?? 1);
