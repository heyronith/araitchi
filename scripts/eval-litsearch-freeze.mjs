#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const runner = path.join(root, "scripts/eval-litsearch-freeze-pools.ts");
const register = pathToFileURL(
  path.join(root, "scripts/register-server-only.mjs"),
).href;

const result = spawnSync(
  "pnpm",
  ["exec", "tsx", "--import", register, runner, ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  },
);
process.exit(result.status ?? 1);
