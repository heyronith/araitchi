"use client";

import { cn } from "cn";

export type ChatMode = "solo" | "auto" | "council";

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
      {(
        [
          { id: "solo" as const, label: "Solo" },
          { id: "auto" as const, label: "Auto" },
          { id: "council" as const, label: "Council" },
        ] as const
      ).map((m) => (
        <button
          key={m.id}
          type="button"
          disabled={disabled}
          aria-pressed={mode === m.id}
          data-testid={`mode-${m.id}`}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
            mode === m.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
