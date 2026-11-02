"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export type ScribeSummaryData = {
  batchId: string;
  costUsd: number | null;
  created: { id: string; type: string; title: string }[];
  updated: { id: string; type: string; title: string }[];
  suggestions: number;
  line: string;
  requireReview: boolean;
};

type MemoryLineProps = {
  data: ScribeSummaryData;
  onHighlight?: (ids: string[]) => void;
  onUndone?: () => void;
};

export function MemoryLine({ data, onHighlight, onUndone }: MemoryLineProps) {
  const [undone, setUndone] = React.useState(false);

  async function undo() {
    const res = await fetch("/api/memory/scribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", batchId: data.batchId }),
    });
    if (!res.ok) {
      toast.error("Could not undo memory update");
      return;
    }
    const json = (await res.json()) as { ok: boolean };
    if (!json.ok) {
      toast.error("Nothing to undo");
      return;
    }
    setUndone(true);
    toast.success("Memory update undone");
    onUndone?.();
  }

  if (undone) {
    return (
      <p
        className="text-muted-foreground text-xs italic"
        data-testid="memory-line"
      >
        Memory: undone
      </p>
    );
  }

  const ids = [
    ...data.created.map((c) => c.id),
    ...data.updated.map((u) => u.id),
  ];

  return (
    <div
      className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
      data-testid="memory-line"
    >
      <button
        type="button"
        className="hover:text-foreground underline-offset-2 hover:underline"
        onClick={() => onHighlight?.(ids)}
      >
        {data.line}
      </button>
      {typeof data.costUsd === "number" ? (
        <span data-testid="scribe-cost">
          + memory ${data.costUsd.toFixed(4)}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        data-testid="memory-undo"
        onClick={() => void undo()}
      >
        Undo
      </Button>
    </div>
  );
}
