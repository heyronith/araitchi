"use client";

import * as React from "react";
import { toast } from "sonner";

import { ModelPicker } from "@/components/chat/model-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CouncilConfigDto = {
  members: string[];
  synthesizer: string;
  maxOutputTokensPerMember: number;
  budgetCapUsd: number;
  memberTimeoutSec: number;
  preset: "balanced" | "budget" | "custom";
};

type CouncilSettingsProps = {
  onChanged?: () => void;
};

export function CouncilSettings({ onChanged }: CouncilSettingsProps) {
  const [config, setConfig] = React.useState<CouncilConfigDto | null>(null);
  const [labWarning, setLabWarning] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/council/config");
    if (!res.ok) return;
    const data = (await res.json()) as {
      config: CouncilConfigDto;
      labWarning: string | null;
    };
    setConfig(data.config);
    setLabWarning(data.labWarning);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch
    void load();
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    const res = await fetch("/api/council/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await res.json()) as {
      error?: string;
      config?: CouncilConfigDto;
      labWarning?: string | null;
    };
    if (!res.ok) {
      toast.error(data.error || "Could not save council settings");
      return;
    }
    if (data.config) setConfig(data.config);
    setLabWarning(data.labWarning ?? null);
    onChanged?.();
    toast.success("Council settings saved");
  };

  if (!config) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={config.preset === "balanced" ? "secondary" : "outline"}
          onClick={() => void save({ applyPreset: "balanced" })}
        >
          Balanced
        </Button>
        <Button
          type="button"
          size="sm"
          variant={config.preset === "budget" ? "secondary" : "outline"}
          onClick={() => void save({ applyPreset: "budget" })}
        >
          Budget
        </Button>
        <Button
          type="button"
          size="sm"
          variant={config.preset === "custom" ? "secondary" : "outline"}
          onClick={() => void save({ preset: "custom" })}
        >
          Custom
        </Button>
      </div>
      {labWarning ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {labWarning}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label>Members ({config.members.length}/10)</Label>
        <ul className="space-y-1">
          {config.members.map((id, index) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
            >
              <span className="text-muted-foreground w-4 text-xs">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{id}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={index === 0}
                onClick={() => {
                  const next = [...config.members];
                  [next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ];
                  void save({ members: next, preset: "custom" });
                }}
              >
                ↑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={index === config.members.length - 1}
                onClick={() => {
                  const next = [...config.members];
                  [next[index + 1], next[index]] = [
                    next[index]!,
                    next[index + 1]!,
                  ];
                  void save({ members: next, preset: "custom" });
                }}
              >
                ↓
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={config.members.length <= 3}
                onClick={() => {
                  const next = config.members.filter((m) => m !== id);
                  void save({ members: next, preset: "custom" });
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        {config.members.length < 10 ? (
          <div className="flex items-center gap-2">
            <ModelPicker value={adding} onChange={setAdding} />
            <Button
              type="button"
              size="sm"
              disabled={!adding || config.members.includes(adding)}
              onClick={() => {
                if (!adding) return;
                void save({
                  members: [...config.members, adding],
                  preset: "custom",
                }).then(() => setAdding(null));
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label>Synthesizer</Label>
        <ModelPicker
          value={config.synthesizer || null}
          onChange={(id) => {
            if (id) void save({ synthesizer: id, preset: "custom" });
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="max-out">Max tokens / member</Label>
          <Input
            id="max-out"
            type="number"
            value={config.maxOutputTokensPerMember}
            onChange={(e) =>
              setConfig({
                ...config,
                maxOutputTokensPerMember: Number(e.target.value),
              })
            }
            onBlur={() =>
              void save({
                maxOutputTokensPerMember: config.maxOutputTokensPerMember,
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="budget">Budget cap (USD)</Label>
          <Input
            id="budget"
            type="number"
            step="0.01"
            value={config.budgetCapUsd}
            onChange={(e) =>
              setConfig({ ...config, budgetCapUsd: Number(e.target.value) })
            }
            onBlur={() => void save({ budgetCapUsd: config.budgetCapUsd })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="timeout">Member timeout (s)</Label>
          <Input
            id="timeout"
            type="number"
            value={config.memberTimeoutSec}
            onChange={(e) =>
              setConfig({
                ...config,
                memberTimeoutSec: Number(e.target.value),
              })
            }
            onBlur={() =>
              void save({ memberTimeoutSec: config.memberTimeoutSec })
            }
          />
        </div>
      </div>
    </div>
  );
}
