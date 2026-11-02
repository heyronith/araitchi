"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TASK_TYPES } from "@/lib/gate/taxonomy";

type GateSettingsDto = {
  knnThreshold: number;
  probeAgreementThreshold: number;
  classifierModel: string;
  probeModels: [string, string];
  alwaysCouncil: string[];
  knnK: number;
  budgetBehaviour: "block" | "warn" | "allow";
};

type Decision = {
  id: string;
  action: string;
  taskType: string;
  stakes: string;
  layer: string;
  confidence: number;
  reason: string;
  escalated: boolean;
  createdAt: number;
  userCorrection: string | null;
};

export function RoutingSettings() {
  const [settings, setSettings] = React.useState<GateSettingsDto | null>(null);
  const [decisions, setDecisions] = React.useState<Decision[]>([]);
  const [filterAction, setFilterAction] = React.useState("all");

  const load = React.useCallback(async () => {
    const [s, d] = await Promise.all([
      fetch("/api/gate/config"),
      fetch("/api/gate/decisions?limit=40"),
    ]);
    if (s.ok) {
      const json = (await s.json()) as { settings: GateSettingsDto };
      setSettings(json.settings);
    }
    if (d.ok) {
      const json = (await d.json()) as { decisions: Decision[] };
      setDecisions(json.decisions);
    }
  }, []);

  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch("/api/gate/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Could not save routing settings");
      return;
    }
    const json = (await res.json()) as { settings: GateSettingsDto };
    setSettings(json.settings);
    toast.success("Routing settings saved");
  }

  if (!settings) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  const filtered =
    filterAction === "all"
      ? decisions
      : decisions.filter((d) => d.action === filterAction);

  return (
    <div className="space-y-6" data-testid="routing-settings">
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Classifier</h3>
        <div className="space-y-1">
          <Label htmlFor="knn-threshold">kNN confidence threshold</Label>
          <Input
            id="knn-threshold"
            type="number"
            step="0.01"
            min={0}
            max={1}
            value={settings.knnThreshold}
            onChange={(e) =>
              setSettings({
                ...settings,
                knnThreshold: Number(e.target.value),
              })
            }
            onBlur={() => void patch({ knnThreshold: settings.knnThreshold })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="classifier-model">
            Classifier model (LLM fallback)
          </Label>
          <Input
            id="classifier-model"
            value={settings.classifierModel}
            onChange={(e) =>
              setSettings({ ...settings, classifierModel: e.target.value })
            }
            onBlur={() =>
              void patch({ classifierModel: settings.classifierModel })
            }
          />
          <p className="text-muted-foreground text-xs">
            Default uses an OpenRouter “latest” alias. Change after{" "}
            <code>pnpm eval:gate</code>.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Probe pair</h3>
        <div className="space-y-1">
          <Label htmlFor="probe-a">Model A</Label>
          <Input
            id="probe-a"
            value={settings.probeModels[0]}
            onChange={(e) =>
              setSettings({
                ...settings,
                probeModels: [e.target.value, settings.probeModels[1]],
              })
            }
            onBlur={() => void patch({ probeModels: settings.probeModels })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="probe-b">Model B</Label>
          <Input
            id="probe-b"
            value={settings.probeModels[1]}
            onChange={(e) =>
              setSettings({
                ...settings,
                probeModels: [settings.probeModels[0], e.target.value],
              })
            }
            onBlur={() => void patch({ probeModels: settings.probeModels })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="probe-thresh">Agreement threshold</Label>
          <Input
            id="probe-thresh"
            type="number"
            step="0.01"
            min={0}
            max={1}
            value={settings.probeAgreementThreshold}
            onChange={(e) =>
              setSettings({
                ...settings,
                probeAgreementThreshold: Number(e.target.value),
              })
            }
            onBlur={() =>
              void patch({
                probeAgreementThreshold: settings.probeAgreementThreshold,
              })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Always council</h3>
        <div className="flex flex-wrap gap-2">
          {TASK_TYPES.filter((t) =>
            [
              "hypothesis_generation",
              "experiment_design",
              "literature_review",
              "critique",
              "results_interpretation",
              "other",
            ].includes(t),
          ).map((t) => {
            const on = settings.alwaysCouncil.includes(t);
            return (
              <button
                key={t}
                type="button"
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  on ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
                onClick={() => {
                  const next = on
                    ? settings.alwaysCouncil.filter((x) => x !== t)
                    : [...settings.alwaysCouncil, t];
                  setSettings({ ...settings, alwaysCouncil: next });
                  void patch({ alwaysCouncil: next });
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Routing log</h3>
          <select
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            value={filterAction}
            data-testid="routing-log-filter"
            onChange={(e) => setFilterAction(e.target.value)}
          >
            <option value="all">All actions</option>
            <option value="solo">Solo</option>
            <option value="retrieve_evidence">Evidence</option>
            <option value="probe">Probe</option>
            <option value="council">Council</option>
          </select>
        </div>
        <div
          className="max-h-56 overflow-auto rounded-md border text-xs"
          data-testid="routing-log"
        >
          <table className="w-full">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="p-1 text-left">When</th>
                <th className="p-1 text-left">Action</th>
                <th className="p-1 text-left">Task</th>
                <th className="p-1 text-left">Layer</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  className="border-t"
                  data-testid="routing-log-row"
                >
                  <td className="p-1">
                    {new Date(d.createdAt).toLocaleString()}
                  </td>
                  <td className="p-1">
                    {d.action}
                    {d.escalated ? " ↑" : ""}
                  </td>
                  <td className="p-1">{d.taskType}</td>
                  <td className="p-1">
                    {d.layer}
                    {d.userCorrection ? " · corrected" : ""}
                  </td>
                </tr>
              ))}
              {!filtered.length ? (
                <tr>
                  <td className="text-muted-foreground p-2" colSpan={4}>
                    No decisions yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="routing-export-corrections"
          onClick={() => {
            window.location.href = "/api/gate/corrections/export?optIn=1";
          }}
        >
          Export anonymised corrections for eval
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
        >
          Refresh log
        </Button>
      </div>
    </div>
  );
}
