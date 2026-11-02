"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const PROVIDERS = [
  ["openalex", "OpenAlex"],
  ["semantic_scholar", "Semantic Scholar"],
  ["arxiv", "arXiv"],
  ["dblp", "DBLP"],
  ["crossref", "Crossref"],
  ["core", "CORE"],
  ["openreview", "OpenReview"],
  ["unpaywall", "Unpaywall"],
] as const;

type McpServer = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headerName?: string;
  headerValue?: string;
  hasHeader?: boolean;
  enabled: boolean;
  readOnly?: boolean;
};

type ToolToggleKey = "papers" | "web" | "documents" | "repo" | "mcp";

const TOGGLES: Array<[ToolToggleKey, string]> = [
  ["papers", "Papers"],
  ["web", "Web search"],
  ["documents", "Documents"],
  ["repo", "Repo (read-only)"],
  ["mcp", "MCP"],
];

type ToolsConfig = {
  toggles: Record<ToolToggleKey, boolean>;
  gitHint?: string;
  contactEmail: string;
  maxSteps: number;
  providers: Record<string, boolean>;
  mcpServers: McpServer[];
};

async function putConfig(body: unknown): Promise<ToolsConfig | null> {
  const res = await fetch("/api/tools/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as ToolsConfig;
}

export function ToolsSettings() {
  const [config, setConfig] = React.useState<ToolsConfig | null>(null);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [transport, setTransport] = React.useState<"stdio" | "http">("stdio");
  const [target, setTarget] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/tools/config");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as ToolsConfig;
      if (cancelled) return;
      setConfig(data);
      setEmail(data.contactEmail ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(body: unknown, okMessage?: string) {
    const next = await putConfig(body);
    if (!next) {
      toast.error("Could not save tool settings");
      return;
    }
    setConfig((prev) => ({ ...next, gitHint: next.gitHint ?? prev?.gitHint }));
    if (okMessage) toast.success(okMessage);
  }

  async function addServer() {
    if (!name.trim() || !target.trim() || !config) return;
    const server: McpServer =
      transport === "stdio"
        ? {
            id: crypto.randomUUID(),
            name: name.trim(),
            transport,
            command: target.trim().split(/\s+/)[0],
            args: target.trim().split(/\s+/).slice(1),
            enabled: true,
          }
        : {
            id: crypto.randomUUID(),
            name: name.trim(),
            transport,
            url: target.trim(),
            enabled: true,
          };
    await save(
      { mcpServers: [...config.mcpServers, server] },
      "MCP server added",
    );
    setName("");
    setTarget("");
  }

  if (!config) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="contact-email">Contact email</Label>
        <p className="text-muted-foreground text-xs">
          Sent as <code>mailto</code> to Crossref / OpenAlex polite pools and
          required for Unpaywall. Not a secret.
        </p>
        <div className="flex gap-2">
          <Input
            id="contact-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void save({ contactEmail: email }, "Saved")}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Tools</p>
        <ul className="grid grid-cols-2 gap-2">
          {TOGGLES.map(([key, label]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <Label htmlFor={`toggle-${key}`}>{label}</Label>
              <Switch
                id={`toggle-${key}`}
                checked={config.toggles?.[key] ?? false}
                onCheckedChange={(v) => void save({ toggles: { [key]: v } })}
              />
            </li>
          ))}
        </ul>
        {config.gitHint ? (
          <p className="text-muted-foreground text-xs" data-testid="git-hint">
            {config.gitHint}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Paper providers</p>
        <ul className="grid grid-cols-2 gap-2">
          {PROVIDERS.map(([key, label]) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <input
                id={`provider-${key}`}
                type="checkbox"
                className="size-4 accent-current"
                checked={config.providers[key] ?? true}
                onChange={(e) =>
                  void save({ providers: { [key]: e.target.checked } })
                }
              />
              <Label htmlFor={`provider-${key}`}>{label}</Label>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <Label htmlFor="max-steps">Max tool steps per reply</Label>
        <Input
          id="max-steps"
          type="number"
          min={1}
          max={20}
          value={config.maxSteps}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1 && n <= 20) {
              void save({ maxSteps: n });
            }
          }}
        />
      </div>

      <div className="space-y-3 rounded-xl border p-4">
        <p className="text-sm font-medium">MCP servers</p>
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
          data-testid="mcp-warning"
        >
          Stdio MCP servers run commands on this computer. Only add servers you
          trust. Their tools ask for approval before every call.
        </p>
        <ul className="space-y-1 text-sm">
          {config.mcpServers.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {s.name}{" "}
                <span className="text-muted-foreground">({s.transport})</span>
              </span>
              <span className="flex items-center gap-2">
                <Switch
                  aria-label={`Enable ${s.name}`}
                  checked={s.enabled}
                  onCheckedChange={(v) =>
                    void save({
                      mcpServers: config.mcpServers.map((x) =>
                        x.id === s.id ? { ...x, enabled: v } : x,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void save({
                      mcpServers: config.mcpServers.filter(
                        (x) => x.id !== s.id,
                      ),
                    })
                  }
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="MCP server name"
            placeholder="Name"
            className="w-32"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            aria-label="MCP transport"
            className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
            value={transport}
            onChange={(e) => setTransport(e.target.value as "stdio" | "http")}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
          <Input
            aria-label="MCP command or URL"
            placeholder={
              transport === "stdio"
                ? "npx some-mcp-server --flag"
                : "https://host/mcp"
            }
            className="min-w-48 flex-1"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <Button type="button" size="sm" onClick={() => void addServer()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
