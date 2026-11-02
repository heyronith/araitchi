"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "cn";

type ReasoningBlockProps = {
  text: string;
  /** True while reasoning is still streaming and no answer text yet. */
  streaming: boolean;
  /** Seconds spent thinking (shown when collapsed). */
  thoughtSeconds: number;
  className?: string;
};

/**
 * Live “Thinking” stream that collapses to “Thought for N s” once the answer
 * starts. Hidden entirely when `text` is empty.
 */
export function ReasoningBlock({
  text,
  streaming,
  thoughtSeconds,
  className,
}: ReasoningBlockProps) {
  // null = follow streaming; boolean = user override
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null);
  const open = userOpen ?? streaming;

  if (!text.trim()) return null;

  const label = streaming
    ? "Thinking"
    : `Thought for ${Math.max(1, thoughtSeconds)} s`;

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setUserOpen(next)}
      className={cn("mb-3", className)}
      data-testid="reasoning-block"
    >
      <CollapsibleTrigger
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
        data-testid="reasoning-toggle"
      >
        {label}
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="text-muted-foreground mt-2 text-xs leading-relaxed whitespace-pre-wrap">
        {text}
      </CollapsibleContent>
    </Collapsible>
  );
}
