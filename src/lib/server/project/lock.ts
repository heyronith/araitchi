import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ProjectLockInfo } from "./types";

export function lockFilePath(researchDir: string): string {
  return path.join(researchDir, ".lock");
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: process exists but we can't signal it.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readLock(researchDir: string): ProjectLockInfo | null {
  const file = lockFilePath(researchDir);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as ProjectLockInfo;
    if (typeof raw.pid !== "number" || typeof raw.timestamp !== "number") {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export type AcquireLockResult =
  | { ok: true; readOnly: false; warning: null }
  | { ok: true; readOnly: true; warning: string }
  | { ok: false; readOnly: true; warning: string };

/** Acquire project lock; if held by another live process, open read-only. */
export function acquireProjectLock(researchDir: string): AcquireLockResult {
  const existing = readLock(researchDir);
  if (existing && existing.pid !== process.pid && isPidAlive(existing.pid)) {
    return {
      ok: true,
      readOnly: true,
      warning: `Project is open in another Araitchi process (PID ${existing.pid}). Opened read-only.`,
    };
  }

  const info: ProjectLockInfo = { pid: process.pid, timestamp: Date.now() };
  try {
    writeFileSync(lockFilePath(researchDir), JSON.stringify(info), {
      mode: 0o600,
    });
    return { ok: true, readOnly: false, warning: null };
  } catch {
    return {
      ok: false,
      readOnly: true,
      warning: "Could not acquire project lock; opened read-only.",
    };
  }
}

export function releaseProjectLock(researchDir: string): void {
  const existing = readLock(researchDir);
  if (!existing || existing.pid !== process.pid) return;
  try {
    unlinkSync(lockFilePath(researchDir));
  } catch {
    // ignore
  }
}
