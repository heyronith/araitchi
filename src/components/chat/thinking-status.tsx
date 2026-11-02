"use client";

import * as React from "react";

import { cn } from "cn";

export type ThinkingPhase =
  | { kind: "thinking" }
  | { kind: "tool"; label: string }
  | { kind: "council"; label: string };

type ThinkingStatusProps = {
  phase: ThinkingPhase;
  className?: string;
  /** When the wait started (ms since epoch). Defaults to mount time. */
  startedAt?: number;
};

export function useElapsedSeconds(startedAt: number, active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  if (!active) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** Animated shimmer status line shown before the first answer token. */
export function ThinkingStatus({
  phase,
  className,
  startedAt: startedAtProp,
}: ThinkingStatusProps) {
  const [mountedAt] = React.useState(() => Date.now());
  const startedAt = startedAtProp ?? mountedAt;
  const elapsed = useElapsedSeconds(startedAt, true);

  const label =
    phase.kind === "thinking"
      ? "Thinking…"
      : phase.kind === "tool"
        ? phase.label
        : phase.label;

  return (
    <div
      data-testid="thinking-status"
      className={cn(
        "text-muted-foreground flex items-baseline gap-2 text-sm",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="animate-pulse font-medium tracking-tight">{label}</span>
      <span className="text-muted-foreground/70 text-xs tabular-nums">
        {elapsed}s
      </span>
    </div>
  );
}

/** Derive a phase label from live tool-call parts. */
export function phaseFromToolCalls(
  calls: { tool: string; status: string }[],
): ThinkingPhase | null {
  if (calls.length === 0) return null;
  const active =
    calls.find((c) => c.status === "needs_approval") ?? calls[calls.length - 1];
  if (!active) return null;
  if (active.status === "needs_approval") {
    return { kind: "tool", label: "Waiting for your approval…" };
  }
  const tool = active.tool.toLowerCase();
  if (tool.includes("search_papers") || tool.includes("paper")) {
    return { kind: "tool", label: "Searching papers…" };
  }
  if (tool.includes("web") || tool.includes("fetch")) {
    return { kind: "tool", label: "Reading web page…" };
  }
  if (tool.includes("repo") || tool.includes("git")) {
    return { kind: "tool", label: "Reading repo…" };
  }
  if (tool.includes("document") || tool.includes("read_document")) {
    return { kind: "tool", label: "Reading document…" };
  }
  return { kind: "tool", label: `Using ${active.tool}…` };
}

export function phaseFromCouncil(input: {
  memberCount: number;
  doneCount: number;
  synthesizing: boolean;
  hasFinalAnswer: boolean;
}): ThinkingPhase | null {
  if (input.hasFinalAnswer) return null;
  if (
    input.synthesizing ||
    (input.memberCount > 0 && input.doneCount >= input.memberCount)
  ) {
    return { kind: "council", label: "Comparing answers…" };
  }
  if (input.memberCount > 0) {
    return {
      kind: "council",
      label: `${input.memberCount} models answering · ${input.doneCount}/${input.memberCount} done`,
    };
  }
  return { kind: "thinking" };
}
