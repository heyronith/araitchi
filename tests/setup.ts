import { afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { closeAppDb } from "@/lib/server/db/client";
import { resetAppDataDirCache } from "@/lib/server/paths";

let tempDir: string | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "araitchi-test-"));
  process.env.ARAITCHI_DATA_DIR = tempDir;
  resetAppDataDirCache();
  closeAppDb();
});

afterEach(() => {
  closeAppDb();
  resetAppDataDirCache();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  delete process.env.ARAITCHI_DATA_DIR;
});
