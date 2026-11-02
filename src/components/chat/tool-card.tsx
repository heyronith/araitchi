"use client";

import { ChevronRight, ShieldAlert, Wrench } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { describeToolCall, type ToolCallView } from "@/lib/chat/tool-events";
import { cn } from "cn";

type ToolCardProps = {
  call: ToolCallView;
  /** Shown for `needs_approval` calls; opens the approval dialog. */
  onReview?: (call: ToolCallView) => void;
};

export function ToolCard({ call, onReview }: ToolCardProps) {
  const [open, setOpen] = React.useState(false);
  const sources = call.sources ?? [];
  const needsApproval = call.status === "needs_approval";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-testid="tool-card"
      data-tool={call.tool}
      data-status={call.status}
      className={cn(
        "bg-muted/30 w-full rounded-lg border text-xs",
        call.status === "error" && "border-destructive/40",
        needsApproval && "border-amber-500/50",
      )}
    >
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-label={`Tool call: ${call.tool}`}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        {needsApproval ? (
          <ShieldAlert className="size-3.5 shrink-0 text-amber-600" />
        ) : (
          <Wrench className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {describeToolCall(call)}
        </span>
        <span className="text-muted-foreground shrink-0">
          {call.cached ? "cached · " : ""}
          {typeof call.durationMs === "number" ? `${call.durationMs}ms` : ""}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t px-3 py-2">
        {call.modelId ? (
          <p className="text-muted-foreground">Model: {call.modelId}</p>
        ) : null}
        {call.args ? (
          <pre className="bg-background max-h-32 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap">
            {JSON.stringify(call.args, null, 2)}
          </pre>
        ) : null}
        {call.error ? <p className="text-destructive">{call.error}</p> : null}
        {sources.length > 0 ? (
          <ul className="space-y-1">
            {sources.slice(0, 10).map((s, i) => (
              <li
                key={`${s.doi ?? s.url ?? s.title}-${i}`}
                className="truncate"
              >
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    {s.title ?? s.url}
                  </a>
                ) : (
                  (s.title ?? s.doi ?? s.arxivId)
                )}
              </li>
            ))}
            {sources.length > 10 ? (
              <li className="text-muted-foreground">
                +{sources.length - 10} more
              </li>
            ) : null}
          </ul>
        ) : null}
        {needsApproval && onReview ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onReview(call)}
          >
            Review request
          </Button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
