import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const e2eDataDir = mkdtempSync(path.join(tmpdir(), "araitchi-e2e-"));
const e2eFsRoot = mkdtempSync(path.join(tmpdir(), "araitchi-fs-"));
const mockPort = 4010;
const mockBase = `http://127.0.0.1:${mockPort}/api/v1`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `pnpm exec tsx e2e/mock-openrouter.ts`,
      url: `http://127.0.0.1:${mockPort}/api/v1/models`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        MOCK_OPENROUTER_PORT: String(mockPort),
      },
    },
    {
      command: "pnpm exec next dev -H 127.0.0.1 -p 3000",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        ARAITCHI_DATA_DIR: e2eDataDir,
        ARAITCHI_FS_ROOT: e2eFsRoot,
        ARAITCHI_OPENROUTER_BASE_URL: mockBase,
        ARAITCHI_OPENALEX_BASE_URL: `http://127.0.0.1:${mockPort}/openalex`,
        ARAITCHI_CORE_BASE_URL: `http://127.0.0.1:${mockPort}/mock/core`,
        ARAITCHI_SEMANTIC_SCHOLAR_BASE_URL: `http://127.0.0.1:${mockPort}/mock/s2`,
        ARAITCHI_ARXIV_BASE_URL: `http://127.0.0.1:${mockPort}/mock/arxiv`,
        ARAITCHI_DBLP_BASE_URL: `http://127.0.0.1:${mockPort}/mock/dblp`,
        ARAITCHI_OPENREVIEW_BASE_URL: `http://127.0.0.1:${mockPort}/mock/openreview`,
        ARAITCHI_CROSSREF_BASE_URL: `http://127.0.0.1:${mockPort}/mock/crossref`,
        ARAITCHI_UNPAYWALL_BASE_URL: `http://127.0.0.1:${mockPort}/mock/unpaywall`,
        ARAITCHI_FAKE_EMBEDDINGS: "1",
        ARAITCHI_MOCK_SCRIBE: JSON.stringify({
          create: [
            {
              type: "hypothesis",
              title: "X causes Y",
              body: "Because Z — durable research fact from chat.",
              status: "proposed",
            },
          ],
          update: [],
        }),
        NEXT_TELEMETRY_DISABLED: "1",
        PORT: "3000",
      },
    },
  ],
});
