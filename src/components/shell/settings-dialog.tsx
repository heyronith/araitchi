"use client";

import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SecretStatus = { name: string; set: boolean };

const KEY_FIELDS = [
  {
    name: "openrouter_api_key" as const,
    label: "OpenRouter API key",
    hint: "Required for chat (Task 2+)",
    required: true,
  },
  {
    name: "semantic_scholar_api_key" as const,
    label: "Semantic Scholar API key",
    hint: "Optional",
    required: false,
  },
  {
    name: "core_api_key" as const,
    label: "CORE API key",
    hint: "Optional",
    required: false,
  },
  {
    name: "github_token" as const,
    label: "GitHub token",
    hint: "Optional, read-only access",
    required: false,
  },
] as const;

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statuses: SecretStatus[];
  onStatusesChange: (statuses: SecretStatus[]) => void;
};

async function fetchSecretStatuses(): Promise<SecretStatus[]> {
  const res = await fetch("/api/secrets");
  if (!res.ok) {
    throw new Error("Failed to load secret status");
  }
  return (await res.json()) as SecretStatus[];
}

export function SettingsDialog({
  open,
  onOpenChange,
  statuses,
  onStatusesChange,
}: SettingsDialogProps) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);

  const isSet = (name: string) =>
    statuses.find((s) => s.name === name)?.set ?? false;

  async function handleSave(name: string) {
    const value = values[name]?.trim() ?? "";
    if (!value) {
      toast.error("Enter a value before saving");
      return;
    }

    setBusy(name);
    try {
      const res = await fetch("/api/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      if (!res.ok) {
        throw new Error("save failed");
      }
      setValues((prev) => ({ ...prev, [name]: "" }));
      onStatusesChange(await fetchSecretStatuses());
      toast.success("Key saved");
    } catch {
      toast.error("Failed to save key");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(name: string) {
    setBusy(name);
    try {
      const res = await fetch(`/api/secrets?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("remove failed");
      }
      setValues((prev) => ({ ...prev, [name]: "" }));
      onStatusesChange(await fetchSecretStatuses());
      toast.success("Key removed");
    } catch {
      toast.error("Failed to remove key");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Keys are encrypted at rest and never shown after saving.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="keys">
          <TabsList>
            <TabsTrigger value="keys">Keys</TabsTrigger>
          </TabsList>
          <TabsContent value="keys" className="mt-4 space-y-5">
            {KEY_FIELDS.map((field) => {
              const saved = isSet(field.name);
              return (
                <div key={field.name} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={field.name}>
                      {field.label}
                      {field.required ? (
                        <span className="text-muted-foreground"> *</span>
                      ) : null}
                    </Label>
                    <Badge variant={saved ? "default" : "secondary"}>
                      {saved ? "Saved" : "Not set"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">{field.hint}</p>
                  <Input
                    id={field.name}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={saved ? "••••••••••••" : "Paste key…"}
                    value={values[field.name] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [field.name]: e.target.value,
                      }))
                    }
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy === field.name}
                      onClick={() => void handleSave(field.name)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy === field.name || !saved}
                      onClick={() => void handleRemove(field.name)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export { fetchSecretStatuses };
export type { SecretStatus };
