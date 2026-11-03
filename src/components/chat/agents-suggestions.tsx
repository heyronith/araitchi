"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Suggestion = {
  id: string;
  proposal: string;
  reason: string;
  createdAt: number;
};

type Props = {
  onChanged?: () => void;
};

export function AgentsSuggestions({ onChanged }: Props) {
  const [items, setItems] = React.useState<Suggestion[]>([]);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/projects/agents/suggestions");
    if (!res.ok) return;
    const data = (await res.json()) as { suggestions: Suggestion[] };
    setItems(data.suggestions);
  }, []);

  React.useEffect(() => {
    const boot = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 3000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(t);
    };
  }, [load]);

  if (!items.length) return null;

  async function act(id: string, action: "accept" | "dismiss") {
    const res = await fetch("/api/projects/agents/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id }),
    });
    if (!res.ok) {
      toast.error("Could not update suggestion");
      return;
    }
    await load();
    onChanged?.();
  }

  return (
    <div className="space-y-2">
      {items.map((s) => (
        <div
          key={s.id}
          className="bg-muted/40 flex flex-col gap-2 rounded-md border px-2 py-2 text-xs"
          data-testid="agents-suggestion"
        >
          <p className="font-medium">Suggested AGENTS.md edit</p>
          <p className="whitespace-pre-wrap">{s.proposal}</p>
          {s.reason ? (
            <p className="text-muted-foreground">{s.reason}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7"
              onClick={() => void act(s.id, "accept")}
            >
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => void act(s.id, "dismiss")}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
