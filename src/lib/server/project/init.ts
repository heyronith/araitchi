import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

import { detectRepoPath } from "./detect-repo";
import { BRIEF_TEMPLATE, RESEARCH_GITIGNORE } from "./templates";
import type { ProjectJson } from "./types";

export function researchDir(projectPath: string): string {
  return path.join(path.resolve(projectPath), ".research");
}

export function ensureResearchStructure(
  projectPath: string,
  options?: { name?: string; id?: string },
): ProjectJson {
  const root = path.resolve(projectPath);
  mkdirSync(root, { recursive: true });

  const research = researchDir(root);
  mkdirSync(research, { recursive: true });
  mkdirSync(path.join(research, "library"), { recursive: true });
  mkdirSync(path.join(research, "sessions"), { recursive: true });

  const gitignorePath = path.join(research, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, RESEARCH_GITIGNORE, "utf8");
  }

  const briefPath = path.join(research, "brief.md");
  if (!existsSync(briefPath)) {
    writeFileSync(briefPath, BRIEF_TEMPLATE, "utf8");
  }

  const memoryPath = path.join(research, "memory.md");
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, "# Memory\n\n_No records yet._\n", "utf8");
  }

  const projectJsonPath = path.join(research, "project.json");
  const repoPath = detectRepoPath(root);
  let project: ProjectJson;

  if (existsSync(projectJsonPath)) {
    try {
      project = JSON.parse(
        readFileSync(projectJsonPath, "utf8"),
      ) as ProjectJson;
      project.repoPath = repoPath;
      if (options?.name) project.name = options.name;
      writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), "utf8");
    } catch {
      project = {
        id: options?.id ?? nanoid(),
        name: options?.name ?? path.basename(root),
        createdAt: Date.now(),
        schemaVersion: 1,
        repoPath,
      };
      writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), "utf8");
    }
  } else {
    project = {
      id: options?.id ?? nanoid(),
      name: options?.name ?? path.basename(root),
      createdAt: Date.now(),
      schemaVersion: 1,
      repoPath,
    };
    writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), "utf8");
  }

  return project;
}

export function readProjectJson(projectPath: string): ProjectJson | null {
  const file = path.join(researchDir(projectPath), "project.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ProjectJson;
  } catch {
    return null;
  }
}

export function readBrief(projectPath: string): string {
  const file = path.join(researchDir(projectPath), "brief.md");
  if (!existsSync(file)) return BRIEF_TEMPLATE;
  return readFileSync(file, "utf8");
}

export function writeBrief(projectPath: string, content: string): void {
  const file = path.join(researchDir(projectPath), "brief.md");
  writeFileSync(file, content, "utf8");
}
