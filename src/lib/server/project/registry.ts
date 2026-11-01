import "server-only";

import { desc, eq } from "drizzle-orm";
import path from "node:path";

import { getAppDb } from "@/lib/server/db/client";
import { projects } from "@/lib/server/db/schema";
import { getSetting, setSetting } from "@/lib/server/settings";

import { getNotebookDb } from "./db";
import { ensureResearchStructure, readProjectJson, researchDir } from "./init";
import { acquireProjectLock, releaseProjectLock } from "./lock";
import type { OpenedProject } from "./types";

export type ProjectRow = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
};

let activeLockPath: string | null = null;

export function listRecentProjects(): ProjectRow[] {
  return getAppDb()
    .select()
    .from(projects)
    .orderBy(desc(projects.lastOpenedAt))
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      lastOpenedAt: p.lastOpenedAt,
    }));
}

export function getCurrentProjectId(): string | null {
  return getSetting<string | null>("current_project_id", null);
}

export function setCurrentProjectId(id: string | null): void {
  setSetting("current_project_id", id);
}

export function getProjectById(id: string): ProjectRow | null {
  const row = getAppDb()
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    lastOpenedAt: row.lastOpenedAt,
  };
}

export function getProjectByPath(projectPath: string): ProjectRow | null {
  const resolved = path.resolve(projectPath);
  const row = getAppDb()
    .select()
    .from(projects)
    .where(eq(projects.path, resolved))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    lastOpenedAt: row.lastOpenedAt,
  };
}

export function removeProjectFromRecents(id: string): boolean {
  const result = getAppDb().delete(projects).where(eq(projects.id, id)).run();
  if (getCurrentProjectId() === id) {
    setCurrentProjectId(null);
  }
  return result.changes > 0;
}

export function releaseActiveProjectLock(): void {
  if (activeLockPath) {
    releaseProjectLock(activeLockPath);
    activeLockPath = null;
  }
}

/**
 * Open (or re-open) a project folder: ensure .research/, lock, register in app DB.
 */
export function openProject(
  projectPath: string,
  options?: { name?: string },
): OpenedProject {
  const root = path.resolve(projectPath);
  const meta = ensureResearchStructure(root, { name: options?.name });
  // Ensure notebook schema/FTS exist.
  getNotebookDb(root);

  const research = researchDir(root);
  // Drop previous process lock if switching projects.
  if (activeLockPath && activeLockPath !== research) {
    releaseProjectLock(activeLockPath);
  }
  const lock = acquireProjectLock(research);
  if (!lock.readOnly) {
    activeLockPath = research;
  }

  const now = Date.now();
  const existingByPath = getProjectByPath(root);
  const existingById = getProjectById(meta.id);

  if (existingByPath) {
    getAppDb()
      .update(projects)
      .set({
        name: meta.name,
        lastOpenedAt: now,
        id: meta.id,
      })
      .where(eq(projects.path, root))
      .run();
  } else if (existingById) {
    getAppDb()
      .update(projects)
      .set({
        name: meta.name,
        path: root,
        lastOpenedAt: now,
      })
      .where(eq(projects.id, meta.id))
      .run();
  } else {
    getAppDb()
      .insert(projects)
      .values({
        id: meta.id,
        name: meta.name,
        path: root,
        lastOpenedAt: now,
      })
      .run();
  }

  setCurrentProjectId(meta.id);

  return {
    id: meta.id,
    name: meta.name,
    path: root,
    researchPath: research,
    repoPath: meta.repoPath,
    readOnly: lock.readOnly,
    lockWarning: lock.warning,
  };
}

export function switchToProject(id: string): OpenedProject | null {
  const row = getProjectById(id);
  if (!row) return null;
  return openProject(row.path, { name: row.name });
}

export function getCurrentOpenedProject(): OpenedProject | null {
  const id = getCurrentProjectId();
  if (!id) return null;
  const row = getProjectById(id);
  if (!row) return null;
  const meta = readProjectJson(row.path);
  if (!meta) {
    // Re-init if missing
    return openProject(row.path, { name: row.name });
  }
  const research = researchDir(row.path);
  const lock = acquireProjectLock(research);
  if (!lock.readOnly) activeLockPath = research;
  return {
    id: meta.id,
    name: meta.name,
    path: row.path,
    researchPath: research,
    repoPath: meta.repoPath,
    readOnly: lock.readOnly,
    lockWarning: lock.warning,
  };
}

/** Require a writable current project path (throws if missing). */
export function requireCurrentProjectPath(): string {
  const id = getCurrentProjectId();
  if (!id) throw new Error("No project open");
  const row = getProjectById(id);
  if (!row) throw new Error("Current project not found");
  return row.path;
}

export function tryCurrentProjectPath(): string | null {
  const id = getCurrentProjectId();
  if (!id) return null;
  return getProjectById(id)?.path ?? null;
}
