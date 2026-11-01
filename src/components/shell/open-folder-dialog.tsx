"use client";

import { FolderPlus, Home } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

type DirEntry = { name: string; path: string };
type Crumb = { name: string; path: string };

type OpenFolderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (project: {
    id: string;
    name: string;
    path: string;
    repoPath: string | null;
    lockWarning: string | null;
  }) => void;
  mode?: "open" | "new";
};

export function OpenFolderDialog({
  open,
  onOpenChange,
  onOpened,
  mode = "open",
}: OpenFolderDialogProps) {
  const [currentPath, setCurrentPath] = React.useState("");
  const [entries, setEntries] = React.useState<DirEntry[]>([]);
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([]);
  const [repoDetected, setRepoDetected] = React.useState(false);
  const [pastePath, setPastePath] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const [confirmPaste, setConfirmPaste] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (p?: string) => {
    const q = p ? `?path=${encodeURIComponent(p)}` : "";
    const res = await fetch(`/api/fs/list${q}`);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || "Failed to list");
    }
    const data = (await res.json()) as {
      path: string;
      entries: DirEntry[];
      breadcrumbs: Crumb[];
      repoDetected: boolean;
    };
    setCurrentPath(data.path);
    setEntries(data.entries);
    setCrumbs(data.breadcrumbs);
    setRepoDetected(data.repoDetected);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- dialog fetch
    void load().catch((e: Error) => toast.error(e.message));
  }, [open, load]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setConfirmPaste(null);
      setPastePath("");
      setNewName("");
    }
    onOpenChange(next);
  };

  const openPath = async (target: string, create = false) => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: target,
          create,
          name: mode === "new" ? newName || undefined : undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        project?: {
          id: string;
          name: string;
          path: string;
          repoPath: string | null;
          lockWarning: string | null;
        };
      };
      if (!res.ok || !data.project) {
        throw new Error(data.error || "Failed to open");
      }
      if (data.project.lockWarning) {
        toast.warning(data.project.lockWarning);
      }
      onOpened(data.project);
      handleOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open");
    } finally {
      setLoading(false);
    }
  };

  const handleNewFolder = async () => {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    const res = await fetch("/api/fs/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parent: currentPath, name: name.trim() }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error || "Could not create folder");
      return;
    }
    const data = (await res.json()) as { path: string };
    await load(currentPath);
    toast.success(`Created ${name.trim()}`);
    void data;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader>
          <DialogTitle>
            {mode === "new" ? "New project" : "Open folder"}
          </DialogTitle>
          <DialogDescription>
            Projects are folders on disk. Araitchi stores memory in{" "}
            <code className="text-xs">.research/</code>.
          </DialogDescription>
        </DialogHeader>

        {mode === "new" ? (
          <div className="space-y-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My research"
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1 text-xs">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Home"
            onClick={() => void load()}
          >
            <Home className="size-3.5" />
          </Button>
          {crumbs.map((c) => (
            <button
              key={c.path}
              type="button"
              className="text-muted-foreground hover:text-foreground max-w-[8rem] truncate"
              onClick={() => void load(c.path)}
            >
              / {c.name}
            </button>
          ))}
        </div>

        <ScrollArea className="h-48 rounded-md border">
          <ul className="p-1">
            {entries.map((e) => (
              <li key={e.path}>
                <button
                  type="button"
                  className="hover:bg-muted w-full truncate rounded-md px-2 py-1.5 text-left text-sm"
                  onDoubleClick={() => void load(e.path)}
                  onClick={() => void load(e.path)}
                >
                  {e.name}
                </button>
              </li>
            ))}
            {entries.length === 0 ? (
              <li className="text-muted-foreground px-2 py-4 text-center text-xs">
                Empty folder
              </li>
            ) : null}
          </ul>
        </ScrollArea>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleNewFolder()}
          >
            <FolderPlus className="size-3.5" />
            New folder
          </Button>
          {repoDetected ? (
            <span className="text-muted-foreground text-xs">Repo detected</span>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="paste-path">Paste a path</Label>
          <div className="flex gap-2">
            <Input
              id="paste-path"
              value={pastePath}
              onChange={(e) => setPastePath(e.target.value)}
              placeholder="/absolute/path/to/folder"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!pastePath.trim()) return;
                setConfirmPaste(pastePath.trim());
              }}
            >
              Use
            </Button>
          </div>
          {confirmPaste ? (
            <div className="bg-muted/50 space-y-2 rounded-md border p-3 text-sm">
              <p>
                Open this path?
                <br />
                <code className="text-xs break-all">{confirmPaste}</code>
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={loading}
                  onClick={() => void openPath(confirmPaste, mode === "new")}
                >
                  Confirm
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmPaste(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={loading || !currentPath}
            onClick={() => void openPath(currentPath, mode === "new")}
          >
            {mode === "new" ? "Create & open" : "Open"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
