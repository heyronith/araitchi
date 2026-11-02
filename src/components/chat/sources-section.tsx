"use client";

import { BookmarkPlus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { mergeSources, type ToolCallView } from "@/lib/chat/tool-events";

export function SourcesSection({ calls }: { calls: ToolCallView[] }) {
  const sources = React.useMemo(() => mergeSources(calls), [calls]);
  const [saved, setSaved] = React.useState<Set<string>>(new Set());
  if (sources.length === 0) return null;

  async function save(key: string) {
    const s = sources.find((x) => x.key === key);
    if (!s?.title) return;
    const res = await fetch("/api/library/papers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: s.title,
        authors: [],
        doi: s.doi ?? null,
        arxivId: s.arxivId ?? null,
        url: s.url ?? null,
        foundBy: s.foundBy,
      }),
    });
    if (!res.ok) {
      toast.error("Could not save paper");
      return;
    }
    setSaved((prev) => new Set(prev).add(key));
    toast.success("Saved to Papers");
  }

  return (
    <section
      aria-label="Sources"
      data-testid="sources-section"
      className="w-full rounded-lg border px-3 py-2 text-xs"
    >
      <h3 className="mb-1 font-medium">Sources</h3>
      <ul className="space-y-1">
        {sources.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
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
              {s.doi ? (
                <span className="text-muted-foreground"> · doi:{s.doi}</span>
              ) : null}
              <span className="text-muted-foreground">
                {" "}
                · found by {s.foundBy.join(", ")}
              </span>
            </span>
            {s.title ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Save paper: ${s.title}`}
                disabled={saved.has(s.key)}
                onClick={() => void save(s.key)}
              >
                <BookmarkPlus className="size-3.5" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
