"use client";

import * as React from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

type StateProposal = {
  id: string;
  section: string;
  content: string;
  evidenceQuote: string;
  createdAt: number;
};

type HistoryEntry = {
  id: string;
  source: string;
  note: string | null;
  createdAt: number;
};

const EDIT_SECTIONS = ["Goal", "Current status", "Next steps"] as const;

type StatePanelProps = {
  active: boolean;
};

export function StatePanel({ active }: StatePanelProps) {
  const [content, setContent] = React.useState("");
  const [proposals, setProposals] = React.useState<StateProposal[]>([]);
  const [sectionEdits, setSectionEdits] = React.useState<
    Record<string, string>
  >({});
  const [preview, setPreview] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [historyView, setHistoryView] = React.useState<string | null>(null);
  const [historyContent, setHistoryContent] = React.useState("");

  const load = React.useCallback(async () => {
    const res = await fetch("/api/projects/state");
    if (!res.ok) return;
    const data = (await res.json()) as {
      content: string;
      proposals?: StateProposal[];
    };
    setContent(data.content);
    setProposals(data.proposals ?? []);
    const secs = parseSections(data.content);
    const edits: Record<string, string> = {};
    for (const name of EDIT_SECTIONS) {
      edits[name] = stripProposals(secs[name] ?? "");
    }
    setSectionEdits(edits);
  }, []);

  React.useEffect(() => {
    if (!active) return;
    const boot = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(boot);
  }, [active, load]);

  async function saveSection(section: (typeof EDIT_SECTIONS)[number]) {
    const res = await fetch("/api/projects/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "writeSection",
        section,
        content: sectionEdits[section] ?? "",
      }),
    });
    if (!res.ok) {
      toast.error("Could not save section");
      return;
    }
    const data = (await res.json()) as { content: string };
    setContent(data.content);
    toast.success(`${section} saved`);
    await load();
  }

  async function proposalAction(
    proposalId: string,
    action: "acceptProposal" | "dismissProposal",
  ) {
    const res = await fetch("/api/projects/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, proposalId }),
    });
    if (!res.ok) {
      toast.error("Could not update proposal");
      return;
    }
    await load();
  }

  async function openHistory() {
    const res = await fetch("/api/projects/state?history=1");
    if (!res.ok) return;
    const data = (await res.json()) as { history: HistoryEntry[] };
    setHistory(data.history);
    setHistoryView(null);
    setHistoryContent("");
    setHistoryOpen(true);
  }

  async function openHistoryEntry(id: string) {
    const res = await fetch(
      `/api/projects/state?historyId=${encodeURIComponent(id)}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      entry: { content: string; note: string | null; source: string };
    };
    setHistoryView(id);
    setHistoryContent(data.entry.content);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col p-3"
      data-testid="state-panel"
    >
      <div className="mb-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={preview ? "outline" : "secondary"}
          onClick={() => setPreview(false)}
        >
          Edit
        </Button>
        <Button
          type="button"
          size="sm"
          variant={preview ? "secondary" : "outline"}
          onClick={() => setPreview(true)}
        >
          Preview
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => void openHistory()}
        >
          View changes
        </Button>
      </div>

      {proposals.length > 0 ? (
        <ul className="mb-3 space-y-2">
          {proposals.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-dashed p-2 text-xs"
            >
              <p className="font-medium">
                {p.section} proposal
                {p.evidenceQuote ? (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    — “{p.evidenceQuote.slice(0, 80)}”
                  </span>
                ) : null}
              </p>
              <p className="text-muted-foreground mt-1 whitespace-pre-wrap">
                {p.content}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7"
                  data-testid="state-accept-proposal"
                  onClick={() => void proposalAction(p.id, "acceptProposal")}
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  data-testid="state-dismiss-proposal"
                  onClick={() =>
                    void proposalAction(p.id, "dismissProposal")
                  }
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {preview ? (
        <ScrollArea className="min-h-0 flex-1 rounded-md border p-3">
          <Markdown content={content} />
        </ScrollArea>
      ) : (
        <ScrollArea className="min-h-0 flex-1 space-y-4">
          {EDIT_SECTIONS.map((section) => (
            <div key={section} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">{section}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => void saveSection(section)}
                >
                  Save
                </Button>
              </div>
              <Textarea
                className="min-h-[72px] font-mono text-xs"
                value={sectionEdits[section] ?? ""}
                onChange={(e) =>
                  setSectionEdits((s) => ({
                    ...s,
                    [section]: e.target.value,
                  }))
                }
                aria-label={`Edit ${section}`}
              />
            </div>
          ))}
        </ScrollArea>
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>STATE.md history</DialogTitle>
          </DialogHeader>
          <div className="grid min-h-0 gap-3 sm:grid-cols-2">
            <ScrollArea
              className="max-h-[60vh] rounded-md border p-2"
              data-testid="state-history"
            >
              <ul className="space-y-1 text-xs">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className={`hover:bg-muted w-full rounded px-2 py-1 text-left ${
                        historyView === h.id ? "bg-muted" : ""
                      }`}
                      onClick={() => void openHistoryEntry(h.id)}
                    >
                      <span className="font-medium">{h.note ?? h.source}</span>
                      <br />
                      <span className="text-muted-foreground">
                        {new Date(h.createdAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
                {!history.length ? (
                  <li className="text-muted-foreground px-2 py-4">
                    No history yet.
                  </li>
                ) : null}
              </ul>
            </ScrollArea>
            <ScrollArea className="max-h-[60vh] rounded-md border p-2">
              {historyContent ? (
                <Markdown content={historyContent} />
              ) : (
                <p className="text-muted-foreground text-xs">
                  Select a version to preview.
                </p>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function parseSections(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = markdown.split("\n");
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current) out[current] = buf.join("\n").trim();
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)\s*$/);
    if (m) {
      flush();
      current = m[1]!.trim();
      buf.length = 0;
      continue;
    }
    if (current) buf.push(line);
  }
  flush();
  return out;
}

function stripProposals(body: string): string {
  return body.replace(/\n### System proposals[\s\S]*$/, "").trim();
}
