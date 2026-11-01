import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import envPaths from "env-paths";

let cachedDataDir: string | null = null;

/** Resolve (and create) the Araitchi app data directory. */
export function getAppDataDir(): string {
  if (cachedDataDir) {
    return cachedDataDir;
  }

  const fromEnv = process.env.ARAITCHI_DATA_DIR?.trim();
  const dataDir = fromEnv
    ? path.resolve(fromEnv)
    : envPaths("araitchi", { suffix: "" }).data;

  mkdirSync(dataDir, { recursive: true });
  cachedDataDir = dataDir;
  return dataDir;
}

/** Reset cached path — used by tests that change ARAITCHI_DATA_DIR. */
export function resetAppDataDirCache(): void {
  cachedDataDir = null;
}
