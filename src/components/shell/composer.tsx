"use client";

import { SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Composer() {
  return (
    <div className="bg-background/80 supports-[backdrop-filter]:bg-background/60 border-t px-3 py-3 backdrop-blur sm:px-4">
      <div className="bg-muted/40 mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border p-2 shadow-sm">
        <Textarea
          aria-label="Message"
          placeholder="Ask Araitchi… (coming in Task 2)"
          disabled
          rows={1}
          className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                type="button"
                size="icon"
                className="shrink-0 rounded-xl"
                disabled
                aria-label="Send message"
              >
                <SendHorizontal className="size-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Coming in Task 2</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
