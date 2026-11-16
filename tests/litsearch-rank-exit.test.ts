/**
 * Smoke: rank --variant qwen --limit 2 must exit by itself (no hung worker).
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = process.cwd();
const smokeDir = mkdtempSync(path.join(tmpdir(), "litsearch-rank-smoke-"));

function tinyPool(index: number) {
  return {
    index,
    query: `tiny rank smoke query ${index}`,
    goldTitles: ["A Tiny Gold Paper About Widgets"],
    papers: [
      {
        title: "A Tiny Gold Paper About Widgets",
        authors: ["Ada"],
        year: 2020,
        abstract: "Widgets and ranking.",
      },
      {
        title: "Unrelated Paper About Cats",
        authors: ["Bob"],
        year: 2019,
        abstract: "Cats.",
      },
    ],
    queries: [`tiny rank smoke query ${index}`],
    builtAt: new Date().toISOString(),
    meta: {
      costUsd: 0,
      openAlexCostUsd: 0,
      poolSize: 2,
      latencyMs: 1,
      openAlexMode: "offline",
    },
  };
}

describe("litsearch rank exit", () => {
  it("rank --variant qwen --limit 2 exits within 90s on its own", async () => {
    mkdirSync(smokeDir, { recursive: true });
    writeFileSync(
      path.join(smokeDir, "0000.json"),
      JSON.stringify(tinyPool(0)) + "\n",
    );
    writeFileSync(
      path.join(smokeDir, "0001.json"),
      JSON.stringify(tinyPool(1)) + "\n",
    );

    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        "pnpm",
        [
          "eval:litsearch:rank",
          "--variant",
          "qwen",
          "--limit",
          "2",
          "--pools-dir",
          smokeDir,
        ],
        {
          cwd: root,
          // Windows CI: pnpm is a .cmd shim — spawn needs shell.
          shell: process.platform === "win32",
          env: {
            ...process.env,
            ARAITCHI_FAKE_EMBEDDINGS: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderr = "";
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error(
            `rank did not exit within 90s (hung). stderr tail:\n${stderr.slice(-800)}`,
          ),
        );
      }, 90_000);
      child.on("exit", (code) => {
        clearTimeout(killTimer);
        resolve(code ?? 1);
      });
    });

    expect(exitCode).toBe(0);
  }, 120_000);

  afterAll(() => {
    rmSync(smokeDir, { recursive: true, force: true });
  });
});
