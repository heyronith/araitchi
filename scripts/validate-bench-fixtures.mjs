#!/usr/bin/env node
/**
 * Validate bench fixtures (offline by default).
 *   pnpm bench:validate-fixtures
 *   pnpm bench:validate-fixtures --online
 *
 * Uses scripts/validate-bench-fixtures-run.ts via tsx (Windows-safe; no -e).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const online = process.argv.includes("--online");

const runner = path.join(root, "scripts/validate-bench-fixtures-run.ts");
const args = ["exec", "tsx", runner, ...(online ? ["--online"] : [])];

const result = spawnSync("pnpm", args, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
