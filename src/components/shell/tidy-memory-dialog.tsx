"use client";

import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type Cluster = {
  type: string;
  ids: string[];
  titles: string[];
  minScore: number;
};

type MergeProposal = {
  id: string;
  type: string;
  keepId: string;
  absorbIds: string[];
  titles: string[];
  minScore: number;
  status?: string;
};

type TidyMemoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
};

export function TidyMemoryDialog({
  open,
  onOpenChange,
  onApplied,
}: TidyMemoryDialogProps) {
  const [clusters, setClusters] = React.useState<Cluster[]>([]);
  const [proposals, setProposals] = React.useState<MergeProposal[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/memory/tidy");
    if (!res.ok) return;
    const data = (await res.json()) as {
      clusters: Cluster[];
      proposals: MergeProposal[];
    };
    setClusters(data.clusters);
    setProposals(
      data.proposals.filter(
        (p) => !p.status || p.status === "pending",
      ),
    );
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  async function proposeMerges() {
    setBusy(true);
    try {
      const res = await fetch("/api/memory/tidy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose" }),
      });
      if (!res.ok) {
        toast.error("Could not propose merges");
        return;
      }
      await load();
      toast.success("Merge proposals ready");
    } finally {
      setBusy(false);
    }
  }

  async function applyMerge(keepId: string, absorbIds: string[]) {
    setBusy(true);
    try {
      const res = await fetch("/api/memory/tidy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "merge", keepId, absorbIds }),
      });
      if (!res.ok) {
        toast.error("Merge failed");
        return;
      }
      toast.success("Records merged");
      await load();
      onApplied?.();
    } finally {
      setBusy(false);
    }
  }

  async function archiveStale() {
    setBusy(true);
    try {
      const res = await fetch("/api/memory/tidy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", days: 60 }),
      });
      if (!res.ok) {
        toast.error("Archive failed");
        return;
      }
      const data = (await res.json()) as { archived?: number };
      toast.success(`Archived ${data.archived ?? 0} stale questions`);
      onApplied?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] sm:max-w-lg"
        data-testid="tidy-memory-dialog"
      >
        <DialogHeader>
          <DialogTitle>Tidy memory</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh] space-y-3 pr-2">
          {clusters.length > 0 ? (
            <div className="mb-4 space-y-2">
              <p className="text-sm font-medium">Duplicate clusters</p>
              {clusters.slice(0, 8).map((c) => (
                <div
                  key={c.ids.join("-")}
                  className="rounded-md border p-2 text-xs"
                >
                  <Badge variant="secondary" className="mb-1">
                    {c.type}
                  </Badge>
                  <ul className="list-disc pl-4">
                    {c.titles.map((t, i) => (
                      <li key={c.ids[i]}>{t}</li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground mt-1">
                    min similarity {(c.minScore * 100).toFixed(0)}%
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No duplicate clusters detected yet.
            </p>
          )}

          {proposals.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Merge proposals</p>
              {proposals.map((p) => (
                <div key={p.id} className="rounded-md border p-2 text-xs">
                  <p>{p.titles.join(" ↔ ")}</p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2 h-7"
                    disabled={busy}
                    onClick={() => void applyMerge(p.keepId, p.absorbIds)}
                  >
                    Approve merge
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </ScrollArea>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void archiveStale()}
          >
            Archive stale questions
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void proposeMerges()}
          >
            Propose merges
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
