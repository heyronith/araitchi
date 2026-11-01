"use client";

import { cn } from "cn";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const MODES = ["Solo", "Auto", "Council"] as const;

export function ModeSwitch() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="group"
          aria-label="Research mode"
          aria-disabled="true"
          className="border-border bg-muted/60 inline-flex rounded-lg border p-0.5 opacity-70"
        >
          {MODES.map((mode, index) => (
            <button
              key={mode}
              type="button"
              disabled
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
                index === 0
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent>Coming soon</TooltipContent>
    </Tooltip>
  );
}
