"use client";

import * as React from "react";

import { cn } from "cn";

export type ContextItem = {
  refId: string;
  kind: string;
  ownerId: string;
  title: string;
  snippet: string;
  tokens: number;
};

type ContextIndicatorProps = {
  pinnedCount: number;
  relevantCount: number;
  totalTokens: number;
  items: ContextItem[];
  vectorUsed?: boolean;
  layerIds?: string[];
  handoffNote?: string | null;
  className?: string;
  onOpenRef?: (ownerId: string) => void;
};

export function ContextIndicator({
  pinnedCount,
  relevantCount,
  totalTokens,
  items,
  vectorUsed = true,
  layerIds = [],
  handoffNote = null,
  className,
  onOpenRef,
}: ContextIndicatorProps) {
  const [open, setOpen] = React.useState(false);
  const tokensLabel =
    totalTokens >= 1000
      ? `${(totalTokens / 1000).toFixed(1)}k`
      : String(totalTokens);

  return (
    <div className={cn("text-muted-foreground text-xs", className)}>
      <button
        type="button"
        data-testid="context-indicator"
        className="hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Context: brief · {pinnedCount} pinned · {relevantCount} relevant (
        {tokensLabel} tokens)
        {!vectorUsed ? " · keyword only" : ""}
        {layerIds.length ? ` · layers: ${layerIds.join(", ")}` : ""}
        {handoffNote ? ` · ${handoffNote}` : ""}
      </button>
      {open ? (
        <ul
          className="bg-muted/40 mt-1 max-h-40 space-y-1 overflow-auto rounded-md border p-2"
          data-testid="context-indicator-details"
        >
          {handoffNote ? (
            <li className="text-foreground font-medium">{handoffNote}</li>
          ) : null}
          {layerIds.length ? (
            <li className="text-muted-foreground">
              Instruction layers: {layerIds.join(", ")}
            </li>
          ) : null}
          {items.map((it) => (
            <li key={`${it.refId}-${it.ownerId}`}>
              <button
                type="button"
                className="hover:text-foreground text-left"
                onClick={() => onOpenRef?.(it.ownerId)}
              >
                <span className="font-medium">[{it.refId}]</span> {it.title}
                <span className="text-muted-foreground">
                  {" "}
                  — {it.snippet.slice(0, 80)}
                </span>
              </button>
            </li>
          ))}
          {!items.length ? <li>No memory items in context.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Turn [H-abcdef] style cites into clickable chips. */
export function renderMemoryRefs(
  text: string,
  onClick?: (refId: string) => void,
): React.ReactNode[] {
  const re = /\[([A-Z]+-[A-Za-z0-9]+)\]/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const refId = m[1]!;
    nodes.push(
      <button
        key={`${refId}-${i++}`}
        type="button"
        data-testid={`memory-ref-${refId}`}
        className="bg-muted text-foreground mx-0.5 inline-flex rounded px-1.5 py-0.5 text-[0.7rem] font-medium"
        onClick={() => onClick?.(refId)}
      >
        [{refId}]
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
