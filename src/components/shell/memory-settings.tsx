"use client";

import * as React from "react";
import { toast } from "sonner";

import { ProjectIndexProgress } from "@/components/shell/project-index-progress";
import { TidyMemoryDialog } from "@/components/shell/tidy-memory-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = {
  embeddingModel: string;
  scribeEnabled: boolean;
  scribeRequireReview: boolean;
  scribeModel: string | null;
  memoryTokens: number;
  lastScribeCostUsd: number | null;
};

export function MemorySettings() {
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [embedder, setEmbedder] = React.useState<{
    state: string;
    progress?: number;
    reason?: string;
    model?: string;
  } | null>(null);
  const [tidyOpen, setTidyOpen] = React.useState(false);
  const importRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/memory/config");
    if (!res.ok) return;
    const data = (await res.json()) as {
      settings: Settings;
      embedder: {
        state: string;
        progress?: number;
        reason?: string;
        model?: string;
      };
    };
    setSettings(data.settings);
    setEmbedder(data.embedder);
  }, []);

  React.useEffect(() => {
    const boot = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 2000);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(t);
    };
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch("/api/memory/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Could not save memory settings");
      return;
    }
    const data = (await res.json()) as { settings: Settings };
    setSettings(data.settings);
    toast.success("Saved");
  }

  if (!settings) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <div className="space-y-4" data-testid="memory-settings">
      <ProjectIndexProgress />
      {embedder?.state === "downloading" ? (
        <p className="text-sm" data-testid="embedder-download-progress">
          Preparing local memory model… {Math.round(embedder.progress ?? 0)}%
          (~610 MB, one-time)
        </p>
      ) : null}
      {embedder?.state === "unavailable" ? (
        <p className="text-destructive text-sm">
          Memory search is keyword-only: {embedder.reason}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="scribe-enabled">Scribe</Label>
          <p className="text-muted-foreground text-xs">
            After each reply, file durable facts into the notebook
          </p>
        </div>
        <input
          id="scribe-enabled"
          type="checkbox"
          data-testid="scribe-enabled"
          checked={settings.scribeEnabled}
          onChange={(e) => void patch({ scribeEnabled: e.target.checked })}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="scribe-review">Require review</Label>
          <p className="text-muted-foreground text-xs">
            Suggestions need Accept before creating records
          </p>
        </div>
        <input
          id="scribe-review"
          type="checkbox"
          data-testid="scribe-require-review"
          checked={settings.scribeRequireReview}
          onChange={(e) =>
            void patch({ scribeRequireReview: e.target.checked })
          }
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="scribe-model">Scribe model</Label>
        <Input
          id="scribe-model"
          placeholder="Default: council synthesizer"
          value={settings.scribeModel ?? ""}
          onChange={(e) =>
            setSettings((s) =>
              s ? { ...s, scribeModel: e.target.value || null } : s,
            )
          }
          onBlur={() =>
            void patch({ scribeModel: settings.scribeModel || null })
          }
        />
        {typeof settings.lastScribeCostUsd === "number" ? (
          <p className="text-muted-foreground text-xs">
            Last scribe cost: ${settings.lastScribeCostUsd.toFixed(4)} / reply
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="embedding-model">Embedding model</Label>
        <select
          id="embedding-model"
          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          value={settings.embeddingModel}
          onChange={(e) => void patch({ embeddingModel: e.target.value })}
        >
          <option value="onnx-community/Qwen3-Embedding-0.6B-ONNX">
            Qwen3-Embedding-0.6B (quality, ~0.6 GB)
          </option>
          <option value="Xenova/all-MiniLM-L6-v2">
            MiniLM-L6-v2 (light, ~25 MB)
          </option>
          <option value="fake">Fake (tests)</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="memory-tokens">Memory context tokens</Label>
        <Input
          id="memory-tokens"
          type="number"
          min={1000}
          max={20000}
          value={settings.memoryTokens}
          onChange={(e) =>
            setSettings((s) =>
              s ? { ...s, memoryTokens: Number(e.target.value) || 6000 } : s,
            )
          }
          onBlur={() => void patch({ memoryTokens: settings.memoryTokens })}
        />
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={() => void patch({ rebuild: true })}
      >
        Rebuild memory index
      </Button>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => setTidyOpen(true)}
        >
          Tidy memory
        </Button>
        <Button
          type="button"
          variant="outline"
          data-testid="backup-export"
          onClick={() =>
            void fetch("/api/memory/backup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "export" }),
            }).then(async (res) => {
              if (!res.ok) {
                toast.error("Export failed");
                return;
              }
              const data = (await res.json()) as { zipPath?: string };
              toast.success(
                data.zipPath
                  ? `Backup saved: ${data.zipPath.split("/").pop()}`
                  : "Backup exported",
              );
            })
          }
        >
          Export backup
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => importRef.current?.click()}
        >
          Import backup…
        </Button>
        <input
          ref={importRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          data-testid="backup-import"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const input = e.target;
            void (async () => {
              async function post(confirm: boolean) {
                const form = new FormData();
                form.set("file", file!);
                if (confirm) form.set("confirmNotebookReplace", "1");
                return fetch("/api/memory/backup", {
                  method: "POST",
                  body: form,
                });
              }
              try {
                let res = await post(false);
                if (res.status === 409) {
                  const data = (await res.json()) as { message?: string };
                  const ok = window.confirm(
                    data.message ??
                      "This backup would replace notebook.db. A pre-import backup will be taken. Continue?",
                  );
                  if (!ok) return;
                  res = await post(true);
                }
                if (!res.ok) {
                  const err = (await res.json().catch(() => null)) as {
                    error?: string;
                  } | null;
                  toast.error(err?.error ?? "Import failed");
                  return;
                }
                toast.success("Backup imported");
              } finally {
                input.value = "";
              }
            })();
          }}
        />
      </div>

      <TidyMemoryDialog open={tidyOpen} onOpenChange={setTidyOpen} />
    </div>
  );
}
