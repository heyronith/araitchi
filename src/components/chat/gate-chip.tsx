"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TASK_TYPES, type TaskType } from "@/lib/gate/taxonomy";

export type GateChipData = {
  decisionId: string;
  action: string;
  actionLabel: string;
  taskType: string;
  taskLabel: string;
  stakes: string;
  layer: string;
  confidence: number;
  reason: string;
  probeAgreement?: number | null;
  escalated?: boolean;
  costUsd?: number | null;
};

type GateChipProps = {
  data: GateChipData;
  userText?: string;
  onRerun?: (action: "solo" | "council") => void;
  onCorrected?: () => void;
};

export function GateChip({
  data,
  userText,
  onRerun,
  onCorrected,
}: GateChipProps) {
  const [open, setOpen] = React.useState(false);
  const [correctTo, setCorrectTo] = React.useState<TaskType>(
    (TASK_TYPES.includes(data.taskType as TaskType)
      ? data.taskType
      : "other") as TaskType,
  );

  async function submitCorrection() {
    const res = await fetch("/api/gate/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: data.decisionId,
        taskType: correctTo,
        text: userText || data.reason,
      }),
    });
    if (!res.ok) {
      toast.error("Could not save correction");
      return;
    }
    toast.success("Correction saved for future routing");
    onCorrected?.();
    setOpen(false);
  }

  return (
    <div
      className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
      data-testid="gate-chip"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="bg-muted hover:bg-muted/80 rounded-full border px-2.5 py-0.5"
            data-testid="gate-chip-label"
          >
            Auto → {data.actionLabel} · {data.taskLabel} · {data.stakes} stakes
            {data.escalated ? " · escalated" : ""}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-2 text-xs" align="start">
          <p className="text-foreground font-medium" data-testid="gate-why">
            Why?
          </p>
          <p>
            Layer: <strong>{data.layer}</strong> · confidence{" "}
            {(data.confidence * 100).toFixed(0)}%
          </p>
          <p className="text-muted-foreground">{data.reason}</p>
          {typeof data.probeAgreement === "number" ? (
            <p>Probe agreement: {data.probeAgreement.toFixed(3)}</p>
          ) : null}
          {typeof data.costUsd === "number" ? (
            <p>Cost: ${data.costUsd.toFixed(4)}</p>
          ) : null}
          <div className="space-y-1 border-t pt-2">
            <p className="font-medium">Should have been:</p>
            <select
              className="border-input bg-background h-8 w-full rounded-md border px-2"
              value={correctTo}
              data-testid="gate-correct-select"
              onChange={(e) => setCorrectTo(e.target.value as TaskType)}
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              className="h-7"
              data-testid="gate-correct-save"
              onClick={() => void submitCorrection()}
            >
              Save correction
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 border-t pt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              data-testid="gate-rerun-solo"
              onClick={() => onRerun?.("solo")}
            >
              Re-run as Solo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              data-testid="gate-rerun-council"
              onClick={() => onRerun?.("council")}
            >
              Re-run as Council
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
