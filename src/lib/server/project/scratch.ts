import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";

import { getAppDb } from "@/lib/server/db/client";
import { projects } from "@/lib/server/db/schema";
import { getAppDataDir } from "@/lib/server/paths";
import { eq } from "drizzle-orm";

import { getNotebookDb } from "./db";
import { ensureResearchStructure } from "./init";
import {
  getCurrentProjectId,
  openProject,
  setCurrentProjectId,
} from "./registry";
import type { OpenedProject } from "./types";

export function getScratchProjectPath(): string {
  return path.join(getAppDataDir(), "scratch");
}

/**
 * Ensure the Scratch folder + .research/ + app DB row exist.
 * Does not change current_project_id unless `makeCurrent` is true.
 */
export function ensureScratchExists(options?: {
  makeCurrent?: boolean;
}): OpenedProject {
  const scratch = getScratchProjectPath();
  mkdirSync(scratch, { recursive: true });
  const meta = ensureResearchStructure(scratch, { name: "Scratch" });
  getNotebookDb(scratch);

  const now = Date.now();
  const existing = getAppDb()
    .select()
    .from(projects)
    .where(eq(projects.path, scratch))
    .get();

  if (existing) {
    getAppDb()
      .update(projects)
      .set({ name: "Scratch", id: meta.id, lastOpenedAt: now })
      .where(eq(projects.path, scratch))
      .run();
  } else {
    const byId = getAppDb()
      .select()
      .from(projects)
      .where(eq(projects.id, meta.id))
      .get();
    if (byId) {
      getAppDb()
        .update(projects)
        .set({ name: "Scratch", path: scratch, lastOpenedAt: now })
        .where(eq(projects.id, meta.id))
        .run();
    } else {
      getAppDb()
        .insert(projects)
        .values({
          id: meta.id,
          name: "Scratch",
          path: scratch,
          lastOpenedAt: now,
        })
        .run();
    }
  }

  if (options?.makeCurrent) {
    setCurrentProjectId(meta.id);
  }

  return {
    id: meta.id,
    name: "Scratch",
    path: scratch,
    researchPath: path.join(scratch, ".research"),
    repoPath: meta.repoPath,
    readOnly: false,
    lockWarning: null,
  };
}

/** Open Scratch as the active project (acquires lock). */
export function ensureScratchProject(): OpenedProject {
  ensureScratchExists();
  return openProject(getScratchProjectPath(), { name: "Scratch" });
}

/** Called on app boot: ensure Scratch exists; open it if nothing else is current. */
export function bootstrapDefaultProject(): void {
  ensureScratchExists({ makeCurrent: !getCurrentProjectId() });
}
