"use client";

import { PanelRight, Pin, Plus, Search, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/chat/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";

export type MemoryRecordDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  status: string | null;
  pinned: boolean;
  source: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sourceChatId: string | null;
  sourceMessageId: string | null;
};

const TABS = [
  { id: "brief", label: "Brief" },
  { id: "hypothesis", label: "Hypotheses" },
  { id: "experiment", label: "Experiments" },
  { id: "decision", label: "Decisions" },
  { id: "paper", label: "Papers" },
  { id: "question", label: "Questions" },
  { id: "note", label: "Notes" },
] as const;

const EMPTY: Record<string, string> = {
  hypothesis: "Claims you want to test or keep track of.",
  experiment: "Plans and runs that test a hypothesis.",
  decision: "Choices you made and why.",
  paper: "Papers and references worth remembering.",
  question: "Open questions the project still needs to answer.",
  note: "Freeform notes that don’t fit elsewhere.",
};

const STATUS_OPTIONS: Record<string, string[]> = {
  hypothesis: ["proposed", "testing", "supported", "refuted", "inconclusive"],
  experiment: ["planned", "running", "done"],
  question: ["open", "answered"],
};

type MemoryPanelProps = {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  refreshKey?: number;
};

export function MemoryPanel({
  collapsed,
  onToggle,
  className,
  refreshKey = 0,
}: MemoryPanelProps) {
  const [tab, setTab] = React.useState<string>("brief");
  const [brief, setBrief] = React.useState("");
  const [briefDirty, setBriefDirty] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [records, setRecords] = React.useState<MemoryRecordDto[]>([]);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MemoryRecordDto | null>(null);
  const [form, setForm] = React.useState({
    title: "",
    body: "",
    status: "" as string,
    tags: "",
    pinned: false,
  });

  const loadBrief = React.useCallback(async () => {
    const res = await fetch("/api/projects/brief");
    if (!res.ok) return;
    const data = (await res.json()) as { content: string };
    setBrief(data.content);
    setBriefDirty(false);
  }, []);

  const loadRecords = React.useCallback(async () => {
    if (tab === "brief") return;
    const params = new URLSearchParams({ type: tab });
    if (query.trim()) params.set("q", query.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    const res = await fetch(`/api/projects/records?${params}`);
    if (!res.ok) return;
    const data = (await res.json()) as { records: MemoryRecordDto[] };
    setRecords(data.records);
  }, [tab, query, statusFilter]);

  React.useEffect(() => {
    if (collapsed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- panel fetch
    if (tab === "brief") void loadBrief();
    else void loadRecords();
  }, [collapsed, tab, loadBrief, loadRecords, refreshKey]);

  React.useEffect(() => {
    if (!briefDirty || tab !== "brief") return;
    const t = setTimeout(() => {
      void fetch("/api/projects/brief", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: brief }),
      }).then(() => setBriefDirty(false));
    }, 800);
    return () => clearTimeout(t);
  }, [brief, briefDirty, tab]);

  const saveBriefNow = async () => {
    await fetch("/api/projects/brief", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: brief }),
    });
    setBriefDirty(false);
    toast.success("Brief saved");
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      title: "",
      body: "",
      status: STATUS_OPTIONS[tab]?.[0] ?? "",
      tags: "",
      pinned: false,
    });
    setEditorOpen(true);
  };

  const openEdit = (r: MemoryRecordDto) => {
    setEditing(r);
    setForm({
      title: r.title,
      body: r.body,
      status: r.status ?? "",
      tags: r.tags.join(", "),
      pinned: r.pinned,
    });
    setEditorOpen(true);
  };

  const saveRecord = async () => {
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (editing) {
      await fetch(`/api/projects/records/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          status: form.status || null,
          tags,
          pinned: form.pinned,
        }),
      });
    } else {
      await fetch("/api/projects/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: tab,
          title: form.title || "Untitled",
          body: form.body,
          status: form.status || null,
          tags,
          pinned: form.pinned,
          source: "user",
        }),
      });
    }
    setEditorOpen(false);
    await loadRecords();
  };

  const togglePin = async (r: MemoryRecordDto) => {
    await fetch(`/api/projects/records/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !r.pinned }),
    });
    await loadRecords();
  };

  const deleteRecord = async (r: MemoryRecordDto) => {
    await fetch(`/api/projects/records/${r.id}`, { method: "DELETE" });
    await loadRecords();
    toast("Deleted", {
      action: {
        label: "Undo",
        onClick: () => {
          void fetch(`/api/projects/records/${r.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restore: true }),
          }).then(() => loadRecords());
        },
      },
    });
  };

  if (collapsed) {
    return (
      <div
        className={cn(
          "border-border flex h-full w-10 flex-col items-center border-l pt-3",
          className,
        )}
      >
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Expand memory panel"
          onClick={onToggle}
        >
          <PanelRight className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "border-border bg-background flex h-full w-[320px] flex-col border-l",
        className,
      )}
    >
      <div className="flex h-14 items-center justify-between gap-2 border-b px-3">
        <span className="text-sm font-medium">Memory</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Collapse memory panel"
          onClick={onToggle}
        >
          <PanelRight className="size-4" />
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="overflow-x-auto border-b px-2 py-2">
          <TabsList className="h-auto flex-wrap justify-start">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent
          value="brief"
          className="mt-0 flex min-h-0 flex-1 flex-col p-3"
        >
          <div className="mb-2 flex gap-2">
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
              className="ml-auto"
              onClick={() => void saveBriefNow()}
            >
              Save
            </Button>
          </div>
          {preview ? (
            <ScrollArea className="min-h-0 flex-1 rounded-md border p-3">
              <Markdown content={brief} />
            </ScrollArea>
          ) : (
            <Textarea
              className="min-h-0 flex-1 font-mono text-xs"
              value={brief}
              onChange={(e) => {
                setBrief(e.target.value);
                setBriefDirty(true);
              }}
              aria-label="Project brief"
            />
          )}
        </TabsContent>

        {TABS.filter((t) => t.id !== "brief").map((t) => (
          <TabsContent
            key={t.id}
            value={t.id}
            className="mt-0 flex min-h-0 flex-1 flex-col p-3"
          >
            <div className="mb-2 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="text-muted-foreground absolute top-2.5 left-2 size-3.5" />
                <Input
                  className="h-8 pl-7"
                  placeholder="Search…"
                  value={tab === t.id ? query : ""}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={`Search ${t.label}`}
                />
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={`Add ${t.label}`}
                onClick={openCreate}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
            {STATUS_OPTIONS[t.id] ? (
              <select
                className="border-input bg-background mb-2 h-8 rounded-md border px-2 text-xs"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                {STATUS_OPTIONS[t.id]!.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : null}
            <ScrollArea className="min-h-0 flex-1">
              {records.length === 0 ? (
                <p className="text-muted-foreground px-1 py-6 text-center text-xs">
                  {EMPTY[t.id]}
                </p>
              ) : (
                <ul className="space-y-2">
                  {records.map((r) => (
                    <li
                      key={r.id}
                      className="hover:bg-muted/50 group rounded-md border p-2"
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => openEdit(r)}
                      >
                        <div className="flex items-start gap-1">
                          <span className="min-w-0 flex-1 text-sm font-medium">
                            {r.title}
                          </span>
                          {r.pinned ? (
                            <Pin className="text-muted-foreground size-3 shrink-0" />
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.status ? (
                            <Badge variant="secondary" className="text-[10px]">
                              {r.status}
                            </Badge>
                          ) : null}
                          <Badge variant="outline" className="text-[10px]">
                            {r.source === "user" ? "You" : r.source}
                          </Badge>
                          <span className="text-muted-foreground text-[10px]">
                            {new Date(r.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                      <div className="mt-1 flex gap-1 opacity-0 group-hover:opacity-100">
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Pin"
                          onClick={() => void togglePin(r)}
                        >
                          <Pin className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Delete"
                          onClick={() => void deleteRecord(r)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit record" : "New record"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rec-title">Title</Label>
              <Input
                id="rec-title"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-body">Body</Label>
              <Textarea
                id="rec-body"
                rows={6}
                value={form.body}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value }))
                }
              />
            </div>
            {STATUS_OPTIONS[tab] ? (
              <div className="space-y-1">
                <Label>Status</Label>
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value }))
                  }
                >
                  {STATUS_OPTIONS[tab]!.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="rec-tags">Tags (comma-separated)</Label>
              <Input
                id="rec-tags"
                value={form.tags}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tags: e.target.value }))
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pinned: e.target.checked }))
                }
              />
              Pinned
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditorOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveRecord()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
