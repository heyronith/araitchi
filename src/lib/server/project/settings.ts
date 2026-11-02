import "server-only";

import { eq } from "drizzle-orm";

import {
  DEFAULT_COUNCIL_CONFIG,
  type ChatMode,
  type CouncilConfig,
} from "@/lib/server/council/types";

import { getNotebookDb } from "./db";
import { projectSettings } from "./schema";

export function getProjectSetting<T>(
  projectPath: string,
  key: string,
  defaultValue: T,
): T {
  const row = getNotebookDb(projectPath)
    .select()
    .from(projectSettings)
    .where(eq(projectSettings.key, key))
    .get();
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export function setProjectSetting(
  projectPath: string,
  key: string,
  value: unknown,
): void {
  const now = Date.now();
  const serialized = JSON.stringify(value);
  getNotebookDb(projectPath)
    .insert(projectSettings)
    .values({ key, value: serialized, updatedAt: now })
    .onConflictDoUpdate({
      target: projectSettings.key,
      set: { value: serialized, updatedAt: now },
    })
    .run();
}

export function getChatMode(projectPath: string): ChatMode {
  const mode = getProjectSetting<ChatMode>(projectPath, "chat.mode", "auto");
  if (mode === "council" || mode === "solo" || mode === "auto") return mode;
  return "auto";
}

export function setChatMode(projectPath: string, mode: ChatMode): void {
  setProjectSetting(projectPath, "chat.mode", mode);
}

export function getCouncilConfig(projectPath: string): CouncilConfig {
  const members = getProjectSetting<string[]>(
    projectPath,
    "council.members",
    [],
  );
  const synthesizer = getProjectSetting<string>(
    projectPath,
    "council.synthesizer",
    "",
  );
  const maxOutputTokensPerMember = getProjectSetting<number>(
    projectPath,
    "council.maxOutputTokensPerMember",
    DEFAULT_COUNCIL_CONFIG.maxOutputTokensPerMember,
  );
  const budgetCapUsd = getProjectSetting<number>(
    projectPath,
    "council.budgetCapUsd",
    DEFAULT_COUNCIL_CONFIG.budgetCapUsd,
  );
  const memberTimeoutSec = getProjectSetting<number>(
    projectPath,
    "council.memberTimeoutSec",
    DEFAULT_COUNCIL_CONFIG.memberTimeoutSec,
  );
  const preset = getProjectSetting<CouncilConfig["preset"]>(
    projectPath,
    "council.preset",
    "balanced",
  );

  return {
    members,
    synthesizer,
    maxOutputTokensPerMember,
    budgetCapUsd,
    memberTimeoutSec,
    preset,
  };
}

export function setCouncilConfig(
  projectPath: string,
  patch: Partial<CouncilConfig>,
): CouncilConfig {
  const current = getCouncilConfig(projectPath);
  const next: CouncilConfig = { ...current, ...patch };
  if (patch.members !== undefined) {
    setProjectSetting(projectPath, "council.members", next.members);
  }
  if (patch.synthesizer !== undefined) {
    setProjectSetting(projectPath, "council.synthesizer", next.synthesizer);
  }
  if (patch.maxOutputTokensPerMember !== undefined) {
    setProjectSetting(
      projectPath,
      "council.maxOutputTokensPerMember",
      next.maxOutputTokensPerMember,
    );
  }
  if (patch.budgetCapUsd !== undefined) {
    setProjectSetting(projectPath, "council.budgetCapUsd", next.budgetCapUsd);
  }
  if (patch.memberTimeoutSec !== undefined) {
    setProjectSetting(
      projectPath,
      "council.memberTimeoutSec",
      next.memberTimeoutSec,
    );
  }
  if (patch.preset !== undefined) {
    setProjectSetting(projectPath, "council.preset", next.preset);
  }
  return next;
}
