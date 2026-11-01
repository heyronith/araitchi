"use client";

import * as React from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";

const TYPES = [
  "hypothesis",
  "experiment",
  "decision",
  "paper",
  "question",
  "note",
] as const;

type SaveToMemoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBody: string;
  source: string;
  sourceChatId?: string | null;
  sourceMessageId?: string | null;
  onSaved?: () => void;
};

function SaveForm({
  initialBody,
  source,
  sourceChatId,
  sourceMessageId,
  onOpenChange,
  onSaved,
}: Omit<SaveToMemoryDialogProps, "open">) {
  const [type, setType] = React.useState<(typeof TYPES)[number]>("note");
  const [title, setTitle] = React.useState(
    () => initialBody.trim().split("\n")[0]?.slice(0, 80) ?? "",
  );
  const [body, setBody] = React.useState(initialBody);

  const save = async () => {
    const res = await fetch("/api/projects/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        title: title || "Untitled",
        body,
        source,
        sourceChatId: sourceChatId ?? null,
        sourceMessageId: sourceMessageId ?? null,
        status:
          type === "hypothesis"
            ? "proposed"
            : type === "experiment"
              ? "planned"
              : type === "question"
                ? "open"
                : null,
      }),
    });
    if (!res.ok) {
      toast.error("Could not save to memory");
      return;
    }
    toast.success("Saved to memory");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="mem-type">Type</Label>
          <select
            id="mem-type"
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mem-title">Title</Label>
          <Input
            id="mem-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mem-body">Body</Label>
          <Textarea
            id="mem-body"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

export function SaveToMemoryDialog({
  open,
  onOpenChange,
  initialBody,
  source,
  sourceChatId,
  sourceMessageId,
  onSaved,
}: SaveToMemoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to memory</DialogTitle>
        </DialogHeader>
        {open ? (
          <SaveForm
            key={`${sourceMessageId ?? "new"}:${initialBody.slice(0, 32)}`}
            initialBody={initialBody}
            source={source}
            sourceChatId={sourceChatId}
            sourceMessageId={sourceMessageId}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
