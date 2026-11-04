"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type Claim = { sentence: string; markers: string[] };

export function TraceabilityView({
  claimMap,
  sourcedCount,
  sentenceCount,
  footer,
  showReasoning = true,
}: {
  claimMap: Claim[];
  sourcedCount: number;
  sentenceCount: number;
  footer?: string;
  showReasoning?: boolean;
}) {
  const [hideReasoning, setHideReasoning] = React.useState(false);
  if (!claimMap.length) return null;

  return (
    <div className="mt-2 space-y-1 text-xs" data-testid="traceability-view">
      <div className="text-muted-foreground flex flex-wrap items-center gap-2">
        <span data-testid="traceability-footer">
          {footer ??
            `Traceability: ${sourcedCount}/${sentenceCount} sentences sourced`}
        </span>
        {showReasoning ? (
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => setHideReasoning((v) => !v)}
          >
            {hideReasoning ? "Show model reasoning" : "Hide model reasoning"}
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        {claimMap.map((c, i) => {
          const sourced = c.markers.length > 0;
          if (!sourced && hideReasoning) return null;
          const invalid = c.markers.filter((m) => m.startsWith("[INVALID:"));
          return (
            <li
              key={i}
              className={cn(
                "rounded px-1 py-0.5",
                !sourced && "text-muted-foreground/80 italic",
              )}
              title={
                sourced
                  ? `Sources: ${c.markers.join(", ")}`
                  : "Model reasoning (no source marker)"
              }
              data-testid={sourced ? "sourced-sentence" : "model-reasoning"}
            >
              <span>{c.sentence}</span>
              {c.markers.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="bg-muted ml-1 inline-flex rounded px-1 font-mono text-[10px]"
                  data-testid="ref-marker"
                  data-marker={m}
                  title={`Open source ${m}`}
                >
                  {m}
                </button>
              ))}
              {invalid.length ? (
                <span
                  className="text-destructive ml-1"
                  data-testid="invalid-marker"
                >
                  invalid reference
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
