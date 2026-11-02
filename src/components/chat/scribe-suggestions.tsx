"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Suggestion = {
  id: string;
  action: string;
  payload: {
    type?: string;
    title?: string;
    body?: string;
    id?: string;
  };
};

type Props = {
  onChanged?: () => void;
};

export function ScribeSuggestions({ onChanged }: Props) {
  const [items, setItems] = React.useState<Suggestion[]>([]);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/memory/scribe");
    if (!res.ok) return;
    const data = (await res.json()) as { suggestions: Suggestion[] };
    setItems(data.suggestions);
  }, []);

  React.useEffect(() => {
    const boot = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 2000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(t);
    };
  }, [load]);

  if (!items.length) return null;

  async function act(id: string, action: "accept" | "dismiss") {
    const res = await fetch("/api/memory/scribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        suggestionId: id,
      }),
    });
    if (!res.ok) {
      toast.error("Could not update suggestion");
      return;
    }
    await load();
    onChanged?.();
  }

  return (
    <div className="space-y-2" data-testid="scribe-suggestions">
      {items.map((s) => (
        <div
          key={s.id}
          className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
          data-testid="scribe-suggestion"
        >
          <span className="min-w-0 flex-1 truncate">
            {s.action}: {s.payload.title ?? s.payload.id ?? "update"}
          </span>
          <Button
            type="button"
            size="sm"
            className="h-6"
            data-testid="scribe-accept"
            onClick={() => void act(s.id, "accept")}
          >
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6"
            data-testid="scribe-dismiss"
            onClick={() => void act(s.id, "dismiss")}
          >
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
}
