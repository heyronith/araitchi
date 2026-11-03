"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";

type Progress = {
  filesDone: number;
  filesTotal: number;
  phase: "idle" | "scanning" | "indexing" | "done";
  exceededLimits?: boolean;
};

type Props = {
  compact?: boolean;
  className?: string;
};

export function ProjectIndexProgress({ compact, className }: Props) {
  const [progress, setProgress] = React.useState<Progress | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/projects/index");
    if (!res.ok) return;
    const data = (await res.json()) as { progress: Progress };
    setProgress(data.progress);
  }, []);

  React.useEffect(() => {
    const boot = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 2000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(t);
    };
  }, [load]);

  const p = progress ?? {
    filesDone: 0,
    filesTotal: 0,
    phase: "idle" as const,
  };

  const indexing = p.phase === "indexing" || p.phase === "scanning";

  if (indexing) {
    return (
      <p
        className={`text-muted-foreground text-xs ${className ?? ""}`}
        data-testid="project-index-progress"
      >
        Indexing {p.filesDone}/{p.filesTotal} files…
        {p.exceededLimits ? " (limits reached)" : ""}
      </p>
    );
  }

  if (p.filesTotal > 0) {
    return (
      <p
        className={`text-muted-foreground text-xs ${className ?? ""}`}
        data-testid="project-index-progress"
      >
        Indexed {p.filesDone}/{p.filesTotal} project files
      </p>
    );
  }

  if (compact) {
    return (
      <p
        className={`text-muted-foreground text-xs ${className ?? ""}`}
        data-testid="project-index-progress"
      >
        Project index idle
      </p>
    );
  }

  return (
    <div className={className} data-testid="project-index-progress">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() =>
          void fetch("/api/projects/index", { method: "POST" }).then(() =>
            load(),
          )
        }
      >
        Index project files
      </Button>
    </div>
  );
}
