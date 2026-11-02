import "server-only";

import { listRecords } from "@/lib/server/project/records";

import { listExperiments } from "./store";
import { effectiveVerdict } from "./verdict";
import type { ExperimentRow } from "./types";

export type TimelineEvent = {
  id: string;
  at: number;
  kind:
    | "hypothesis"
    | "experiment_created"
    | "experiment_locked"
    | "verdict"
    | "override"
    | "replication";
  title: string;
  status: string | null;
  experimentId?: string;
  hypothesisId?: string;
  version?: number;
  detail?: string;
  href?: string;
};

export function buildTimeline(
  projectPath: string,
  opts?: { status?: string },
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const h of listRecords(projectPath, { type: "hypothesis" })) {
    events.push({
      id: `hyp-${h.id}`,
      at: h.createdAt,
      kind: "hypothesis",
      title: h.title,
      status: h.status,
      hypothesisId: h.id,
      detail: h.body.slice(0, 160),
    });
  }

  let exps: ExperimentRow[] = listExperiments(projectPath);
  if (opts?.status && opts.status !== "all") {
    exps = exps.filter(
      (e) => e.status === opts.status || effectiveVerdict(e) === opts.status,
    );
  }

  for (const e of exps) {
    events.push({
      id: `exp-create-${e.id}`,
      at: e.createdAt,
      kind: e.replicationOf ? "replication" : "experiment_created",
      title: e.title,
      status: e.status,
      experimentId: e.id,
      version: e.version,
      detail: e.replicationOf
        ? `Replication of ${e.replicationOf}`
        : `v${e.version} · ${e.objective.slice(0, 120)}`,
    });
    if (e.lockedAt) {
      events.push({
        id: `exp-lock-${e.id}`,
        at: e.lockedAt,
        kind: "experiment_locked",
        title: `Locked ${e.id}`,
        status: "locked",
        experimentId: e.id,
        version: e.version,
        detail: e.lockHash?.slice(0, 12),
      });
    }
    if (e.verdict && e.verdictEvidence) {
      events.push({
        id: `exp-verdict-${e.id}`,
        at: e.verdictEvidence.checkedAt,
        kind: "verdict",
        title: `${e.id} → ${effectiveVerdict(e)}`,
        status: effectiveVerdict(e),
        experimentId: e.id,
        version: e.version,
        detail: e.verdictEvidence.reasons[0],
      });
    }
    if (e.overrideAt && e.overrideVerdict) {
      events.push({
        id: `exp-override-${e.id}`,
        at: e.overrideAt,
        kind: "override",
        title: `Override ${e.id} → ${e.overrideVerdict}`,
        status: e.overrideVerdict,
        experimentId: e.id,
        detail: e.overrideReason ?? undefined,
      });
    }
  }

  events.sort((a, b) => b.at - a.at);
  return events;
}
