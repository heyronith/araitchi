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
import { CouncilSettings } from "@/components/shell/council-settings";
import { EvaluationsPanel } from "@/components/shell/evaluations-panel";
import { InstructionsSettings } from "@/components/shell/instructions-settings";
import { MemorySettings } from "@/components/shell/memory-settings";
import { RoutingSettings } from "@/components/shell/routing-settings";
import { ToolsSettings } from "@/components/shell/tools-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SettingsTab =
  | "keys"
  | "models"
  | "council"
  | "tools"
  | "memory"
  | "instructions"
  | "routing"
  | "evals";

type SecretStatus = { name: string; set: boolean };

type KeyInfo = {
  ok: boolean;
  label?: string | null;
  usage?: number | null;
  limit?: number | null;
  limitRemaining?: number | null;
  error?: string;
};

const KEY_FIELDS = [
  {
    name: "openrouter_api_key" as const,
    label: "OpenRouter API key",
    hint: "Manual fallback if you prefer pasting a key",
    required: true,
  },
  {
    name: "openalex_api_key" as const,
    label: "OpenAlex API key",
    hint: "Optional — free at openalex.org",
    signup: "https://openalex.org/",
    required: false,
  },
  {
    name: "semantic_scholar_api_key" as const,
    label: "Semantic Scholar API key",
    hint: "Optional — semanticscholar.org/product/api",
    signup: "https://www.semanticscholar.org/product/api",
    required: false,
  },
  {
    name: "core_api_key" as const,
    label: "CORE API key",
    hint: "Optional — core.ac.uk/services/api",
    signup: "https://core.ac.uk/services/api",
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
  initialTab?: SettingsTab;
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
  initialTab = "keys",
}: SettingsDialogProps) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [keyInfo, setKeyInfo] = React.useState<KeyInfo | null>(null);
  const [defaultModelId, setDefaultModelId] = React.useState<string | null>(
    null,
  );
  const [modelOptions, setModelOptions] = React.useState<
    Array<{ id: string; name: string }>
  >([]);
  const [tab, setTab] = React.useState<SettingsTab>(initialTab);

  const isSet = (name: string) =>
    statuses.find((s) => s.name === name)?.set ?? false;

  const openrouterSet = isSet("openrouter_api_key");

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) return;
    setTab(initialTab);
    if (openrouterSet) {
      void fetch("/api/openrouter/test", { method: "POST" })
        .then(async (res) => {
          setKeyInfo((await res.json()) as KeyInfo);
        })
        .catch(() => setKeyInfo({ ok: false, error: "test_failed" }));
    } else {
      setKeyInfo(null);
    }
    void fetch("/api/models")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          models: Array<{ id: string; name: string }>;
          defaultModelId: string | null;
        };
        setModelOptions(data.models.slice(0, 200));
        setDefaultModelId(data.defaultModelId);
      })
      .catch(() => undefined);
  };

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
      if (!res.ok) throw new Error("save failed");
      setValues((prev) => ({ ...prev, [name]: "" }));
      onStatusesChange(await fetchSecretStatuses());
      toast.success("Key saved");
      if (name === "openrouter_api_key") {
        void fetch("/api/openrouter/test", { method: "POST" })
          .then(async (r) => setKeyInfo((await r.json()) as KeyInfo))
          .catch(() => setKeyInfo({ ok: false, error: "test_failed" }));
      }
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
      if (!res.ok) throw new Error("remove failed");
      setValues((prev) => ({ ...prev, [name]: "" }));
      onStatusesChange(await fetchSecretStatuses());
      if (name === "openrouter_api_key") setKeyInfo(null);
      toast.success("Key removed");
    } catch {
      toast.error("Failed to remove key");
    } finally {
      setBusy(null);
    }
  }

  async function saveDefaultModel(id: string) {
    setDefaultModelId(id);
    await fetch("/api/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultModelId: id }),
    });
    toast.success("Default model saved");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Keys are encrypted at rest and never shown after saving. Usage is
            billed to your OpenRouter account.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)}>
          <TabsList>
            <TabsTrigger value="keys">Keys</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="council">Council</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="routing">Routing</TabsTrigger>
            <TabsTrigger value="evals">Evaluations</TabsTrigger>
          </TabsList>

          <TabsContent value="keys" className="mt-4 space-y-5">
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">OpenRouter</p>
                  <p className="text-muted-foreground text-xs">
                    Preferred: connect with OAuth (PKCE).
                  </p>
                </div>
                {openrouterSet ? (
                  <Badge variant="default">Saved</Badge>
                ) : (
                  <Badge variant="secondary">Not set</Badge>
                )}
              </div>

              {keyInfo?.ok ? (
                <p className="text-sm">
                  Connected
                  {typeof keyInfo.limitRemaining === "number"
                    ? ` · $${keyInfo.limitRemaining.toFixed(2)} remaining`
                    : typeof keyInfo.usage === "number"
                      ? ` · $${keyInfo.usage.toFixed(4)} used`
                      : ""}
                  {keyInfo.label ? ` · ${keyInfo.label}` : ""}
                </p>
              ) : openrouterSet && keyInfo && !keyInfo.ok ? (
                <p className="text-destructive text-sm">Invalid key</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="button" asChild>
                  <a href="/api/openrouter/connect">Connect with OpenRouter</a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!openrouterSet || busy === "openrouter_api_key"}
                  onClick={() => void handleRemove("openrouter_api_key")}
                >
                  Disconnect
                </Button>
              </div>
            </div>

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
                  {"signup" in field && field.signup ? (
                    <a
                      className="text-primary text-xs underline"
                      href={field.signup}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Sign up
                    </a>
                  ) : null}
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

          <TabsContent value="models" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default-model">Default model</Label>
              <select
                id="default-model"
                className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
                value={defaultModelId ?? ""}
                onChange={(e) => void saveDefaultModel(e.target.value)}
              >
                <option value="" disabled>
                  Select a default…
                </option>
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">
                Used when opening a new chat. Refresh the model list from the
                composer picker.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="council" className="mt-4">
            <CouncilSettings />
          </TabsContent>

          <TabsContent value="tools" className="mt-4">
            <ToolsSettings />
          </TabsContent>

          <TabsContent value="memory" className="mt-4">
            <MemorySettings />
          </TabsContent>

          <TabsContent value="instructions" className="mt-4">
            <InstructionsSettings />
          </TabsContent>

          <TabsContent value="routing" className="mt-4">
            <RoutingSettings />
          </TabsContent>

          <TabsContent value="evals" className="mt-4">
            <EvaluationsPanel />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export { fetchSecretStatuses };
export type { SecretStatus };
