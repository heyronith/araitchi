import "server-only";

import { createHash } from "node:crypto";

import { listRecentProjects } from "@/lib/server/project/registry";

import { listProjectCorrections } from "./corrections";
import { actionForTaskType } from "./taxonomy";

export type AnonymisedCorrectionLine = {
  textHash: string;
  taskType: string;
  action: string;
  stakes: string;
  needsEvidence: boolean;
};

export function exportAnonymisedCorrections(): AnonymisedCorrectionLine[] {
  const seen = new Set<string>();
  const lines: AnonymisedCorrectionLine[] = [];

  for (const project of listRecentProjects()) {
    for (const c of listProjectCorrections(project.path)) {
      const textHash = createHash("sha256").update(c.text.trim()).digest("hex");
      const dedupe = `${textHash}:${c.taskType}:${c.stakes}:${c.needsEvidence}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      lines.push({
        textHash,
        taskType: c.taskType,
        action: actionForTaskType(c.taskType),
        stakes: c.stakes,
        needsEvidence: c.needsEvidence,
      });
    }
  }

  lines.sort(
    (a, b) =>
      a.textHash.localeCompare(b.textHash) ||
      a.taskType.localeCompare(b.taskType),
  );
  return lines;
}

export function anonymisedCorrectionsJsonl(): string {
  const lines = exportAnonymisedCorrections();
  if (!lines.length) return "";
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}
