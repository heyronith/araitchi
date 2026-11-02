"use client";

import { cn } from "cn";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ChatMode = "solo" | "council";

type ModeSwitchProps = {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled?: boolean;
};

export function ModeSwitch({ mode, onChange, disabled }: ModeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Research mode"
      className="border-border bg-muted/60 inline-flex rounded-lg border p-0.5"
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={mode === "solo"}
        className={cn(
          "rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
          mode === "solo"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => onChange("solo")}
      >
        Solo
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            aria-pressed={false}
            className="text-muted-foreground cursor-not-allowed rounded-md px-2.5 py-1 text-xs font-medium opacity-60 sm:px-3 sm:text-sm"
          >
            Auto
          </button>
        </TooltipTrigger>
        <TooltipContent>Coming in Task 7</TooltipContent>
      </Tooltip>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={mode === "council"}
        className={cn(
          "rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
          mode === "council"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => onChange("council")}
      >
        Council
      </button>
    </div>
  );
}
