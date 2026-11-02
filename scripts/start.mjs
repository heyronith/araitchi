#!/usr/bin/env node
/**
 * Production start wrapper: next start on 127.0.0.1:3000, opens the browser
 * unless --no-open is passed. Extra args are forwarded to `next start`.
 *
 * Usage: pnpm start [--no-open] [...next-start-args]
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const host = "127.0.0.1";
const port = "3000";
const url = `http://${host}:${port}`;

const argv = process.argv.slice(2);
const noOpen = argv.includes("--no-open");
const forwarded = argv.filter((a) => a !== "--no-open");

const nextBin = require.resolve("next/dist/bin/next", { paths: [root] });

const child = spawn(
  process.execPath,
  [nextBin, "start", "-H", host, "-p", port, ...forwarded],
  {
    cwd: root,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "inherit",
  },
);

function openBrowser(target) {
  const { platform } = process;
  let cmd;
  let args;
  if (platform === "darwin") {
    cmd = "open";
    args = [target];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", target];
  } else {
    cmd = "xdg-open";
    args = [target];
  }
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Non-fatal: server still runs if the browser cannot open.
  }
}

async function waitForHealth(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

if (!noOpen) {
  // Prefer opening after health is up; fall back so the browser still launches.
  waitForHealth().finally(() => openBrowser(url));
}

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
