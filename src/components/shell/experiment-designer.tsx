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

export type ExperimentDto = {
  id: string;
  familyId: string;
  version: number;
  hypothesisIds: string[];
  title: string;
  objective: string;
  protocol: string;
  baselines: string;
  dataset: string;
  requiredRuns: number;
  seeds: number[];
  environmentNotes: string;
  predictions: {
    id: string;
    metric: string;
    comparator: string;
    value?: number;
    tolerance?: number;
    low?: number;
    high?: number;
    baseline?: { metric: string };
    minImprovementPct?: number;
    aggregate: string;
  }[];
  resultsPath: string;
  status: string;
  lockedAt: number | null;
  lockHash: string | null;
  verdict: string | null;
  interpretation: string | null;
  interpretationConcern: boolean;
  overrideVerdict: string | null;
  overrideReason: string | null;
  verdictEvidence: {
    reasons: string[];
    predictions: {
      predictionId: string;
      observed: unknown;
      expected: string;
      pass: boolean | null;
    }[];
    commitSha: string | null;
    filePath: string;
  } | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hypothesisId?: string;
  hypothesisTitle?: string;
  onChanged?: () => void;
};

type PredRow = {
  id: string;
  metric: string;
  comparator: string;
  value?: number;
  tolerance?: number;
  low?: number;
  high?: number;
  baseline?: { metric: string };
  minImprovementPct?: number;
  aggregate: string;
};

const emptyPred = (): PredRow => ({
  id: `p${Math.random().toString(36).slice(2, 6)}`,
  metric: "accuracy",
  comparator: ">",
  value: 0.5,
  aggregate: "mean",
});

export function ExperimentDesigner({
  open,
  onOpenChange,
  hypothesisId,
  hypothesisTitle,
  onChanged,
}: Props) {
  const [busy, setBusy] = React.useState(false);
  const [experiment, setExperiment] = React.useState<ExperimentDto | null>(
    null,
  );
  const [instructions, setInstructions] = React.useState("");
  const [overrideReason, setOverrideReason] = React.useState("");
  const [form, setForm] = React.useState<{
    title: string;
    objective: string;
    protocol: string;
    baselines: string;
    dataset: string;
    requiredRuns: number;
    seeds: string;
    environmentNotes: string;
    predictions: PredRow[];
  }>({
    title: "",
    objective: "",
    protocol: "",
    baselines: "",
    dataset: "",
    requiredRuns: 3,
    seeds: "1,2,3",
    environmentNotes: "",
    predictions: [emptyPred()],
  });

  const syncForm = (exp: ExperimentDto) => {
    setExperiment(exp);
    setForm({
      title: exp.title,
      objective: exp.objective,
      protocol: exp.protocol,
      baselines: exp.baselines,
      dataset: exp.dataset,
      requiredRuns: exp.requiredRuns,
      seeds: exp.seeds.join(","),
      environmentNotes: exp.environmentNotes,
      predictions: exp.predictions.map((p) => ({ ...p })),
    });
  };

  const design = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hypothesisId,
          prompt: hypothesisTitle
            ? `Design an experiment for: ${hypothesisTitle}`
            : undefined,
          draft: {
            title: form.title || hypothesisTitle || "Untitled experiment",
            objective:
              form.objective ||
              `Test hypothesis: ${hypothesisTitle ?? hypothesisId}`,
            protocol:
              form.protocol ||
              "1. Implement under experiments/<id>/\n2. Run with given seeds\n3. Write results.json",
            baselines: form.baselines,
            dataset: form.dataset,
            requiredRuns: form.requiredRuns,
            seeds: form.seeds
              .split(/[,\s]+/)
              .map((s) => Number(s))
              .filter((n) => Number.isFinite(n)),
            environmentNotes: form.environmentNotes,
            predictions: form.predictions,
          },
        }),
      });
      const data = (await res.json()) as {
        experiment?: ExperimentDto;
        error?: string;
      };
      if (!res.ok || !data.experiment) {
        toast.error(data.error ?? "Design failed");
        return;
      }
      syncForm(data.experiment);
      toast.success(`Draft ${data.experiment.id} created`);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!experiment) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/experiments/${experiment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          objective: form.objective,
          protocol: form.protocol,
          baselines: form.baselines,
          dataset: form.dataset,
          requiredRuns: form.requiredRuns,
          seeds: form.seeds
            .split(/[,\s]+/)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n)),
          environmentNotes: form.environmentNotes,
          predictions: form.predictions,
        }),
      });
      const data = (await res.json()) as {
        experiment?: ExperimentDto;
        error?: string;
      };
      if (!res.ok || !data.experiment) {
        toast.error(data.error ?? "Save failed");
        return;
      }
      syncForm(data.experiment);
      toast.success(
        data.experiment.id !== experiment.id
          ? `Created version ${data.experiment.version} (${data.experiment.id})`
          : "Draft saved",
      );
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    if (!experiment) return;
    setBusy(true);
    try {
      await saveDraft();
      const res = await fetch(`/api/experiments/${experiment.id}/lock`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        experiment?: ExperimentDto;
        error?: string;
      };
      if (!res.ok || !data.experiment) {
        toast.error(data.error ?? "Lock failed");
        return;
      }
      syncForm(data.experiment);
      toast.success("Predictions locked");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const genInstructions = async () => {
    if (!experiment) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/experiments/${experiment.id}/instructions`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        markdown?: string;
        error?: string;
      };
      if (!res.ok || !data.markdown) {
        toast.error(data.error ?? "Failed");
        return;
      }
      setInstructions(data.markdown);
      await navigator.clipboard.writeText(data.markdown).catch(() => null);
      toast.success("Instructions saved and copied");
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!experiment) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/experiments/${experiment.id}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipInterpretation: true }),
      });
      const data = (await res.json()) as {
        experiment?: ExperimentDto;
        error?: string;
      };
      if (!res.ok || !data.experiment) {
        toast.error(data.error ?? "Check failed");
        return;
      }
      syncForm(data.experiment);
      toast.success(`Verdict: ${data.experiment.verdict}`);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const override = async () => {
    if (!experiment) return;
    if (!overrideReason.trim()) {
      toast.error("Override requires a written reason");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/experiments/${experiment.id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict: "supported",
          reason: overrideReason,
        }),
      });
      const data = (await res.json()) as {
        experiment?: ExperimentDto;
        error?: string;
      };
      if (!res.ok || !data.experiment) {
        toast.error(data.error ?? "Override failed");
        return;
      }
      syncForm(data.experiment);
      toast.success("Override recorded");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        data-testid="experiment-designer"
      >
        <DialogHeader>
          <DialogTitle>
            {experiment
              ? `${experiment.id} · ${experiment.status}`
              : "Design experiment"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 text-sm">
          <div>
            <Label htmlFor="exp-title">Title</Label>
            <Input
              id="exp-title"
              data-testid="exp-title"
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value }))
              }
            />
          </div>
          <div>
            <Label htmlFor="exp-objective">Objective</Label>
            <Textarea
              id="exp-objective"
              data-testid="exp-objective"
              rows={3}
              value={form.objective}
              onChange={(e) =>
                setForm((f) => ({ ...f, objective: e.target.value }))
              }
            />
          </div>
          <div>
            <Label htmlFor="exp-protocol">Protocol</Label>
            <Textarea
              id="exp-protocol"
              data-testid="exp-protocol"
              rows={4}
              value={form.protocol}
              onChange={(e) =>
                setForm((f) => ({ ...f, protocol: e.target.value }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="exp-runs">Required runs</Label>
              <Input
                id="exp-runs"
                type="number"
                data-testid="exp-runs"
                value={form.requiredRuns}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    requiredRuns: Number(e.target.value) || 1,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="exp-seeds">Seeds</Label>
              <Input
                id="exp-seeds"
                data-testid="exp-seeds"
                value={form.seeds}
                onChange={(e) =>
                  setForm((f) => ({ ...f, seeds: e.target.value }))
                }
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Predictions</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="exp-add-prediction"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    predictions: [...f.predictions, emptyPred()],
                  }))
                }
              >
                Add row
              </Button>
            </div>
            <div className="space-y-2">
              {form.predictions.map((p, idx) => (
                <div
                  key={p.id}
                  className="grid grid-cols-4 gap-1"
                  data-testid="exp-prediction-row"
                >
                  <Input
                    aria-label="metric"
                    value={p.metric}
                    onChange={(e) => {
                      const predictions = [...form.predictions];
                      predictions[idx] = { ...p, metric: e.target.value };
                      setForm((f) => ({ ...f, predictions }));
                    }}
                  />
                  <select
                    className="border-input bg-background rounded-md border px-2 text-xs"
                    aria-label="comparator"
                    data-testid="exp-pred-comparator"
                    value={p.comparator}
                    onChange={(e) => {
                      const predictions = [...form.predictions];
                      predictions[idx] = {
                        ...p,
                        comparator: e.target.value,
                      };
                      setForm((f) => ({ ...f, predictions }));
                    }}
                  >
                    {[
                      "...",
                      ">",
                      ">=",
                      "<",
                      "<=",
                      "==",
                      "between",
                      "improves_over",
                    ]
                      .slice(1)
                      .map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                  </select>
                  <Input
                    aria-label="value"
                    data-testid="exp-pred-value"
                    type="number"
                    value={p.value ?? ""}
                    onChange={(e) => {
                      const predictions = [...form.predictions];
                      predictions[idx] = {
                        ...p,
                        value: Number(e.target.value),
                      };
                      setForm((f) => ({ ...f, predictions }));
                    }}
                  />
                  <Input
                    aria-label="aggregate"
                    value={p.aggregate}
                    onChange={(e) => {
                      const predictions = [...form.predictions];
                      predictions[idx] = {
                        ...p,
                        aggregate: e.target.value,
                      };
                      setForm((f) => ({ ...f, predictions }));
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {experiment?.verdict ? (
            <div
              className="bg-muted/50 rounded-md border p-3"
              data-testid="exp-verdict"
            >
              <p className="font-medium">
                Verdict: {experiment.overrideVerdict ?? experiment.verdict}
                {experiment.interpretationConcern ? " · concern" : ""}
              </p>
              <ul className="text-muted-foreground mt-1 list-disc pl-4 text-xs">
                {(experiment.verdictEvidence?.reasons ?? []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {experiment.interpretation ? (
                <p className="mt-2 text-xs" data-testid="exp-interpretation">
                  {experiment.interpretation}
                </p>
              ) : null}
            </div>
          ) : null}

          {instructions ? (
            <Textarea
              readOnly
              rows={8}
              value={instructions}
              data-testid="exp-instructions"
            />
          ) : null}

          <div>
            <Label htmlFor="exp-override-reason">Override reason</Label>
            <Input
              id="exp-override-reason"
              data-testid="exp-override-reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Required to override verdict"
            />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {!experiment ? (
            <Button
              type="button"
              data-testid="exp-design"
              disabled={busy}
              onClick={() => void design()}
            >
              Design experiment
            </Button>
          ) : null}
          {experiment?.status === "draft" ? (
            <>
              <Button
                type="button"
                variant="outline"
                data-testid="exp-save"
                disabled={busy}
                onClick={() => void saveDraft()}
              >
                Save draft
              </Button>
              <Button
                type="button"
                data-testid="exp-lock"
                disabled={busy}
                onClick={() => void lock()}
              >
                Lock predictions
              </Button>
            </>
          ) : null}
          {experiment && experiment.status !== "draft" ? (
            <>
              <Button
                type="button"
                variant="outline"
                data-testid="exp-instructions-btn"
                disabled={busy}
                onClick={() => void genInstructions()}
              >
                Generate Cursor instructions
              </Button>
              <Button
                type="button"
                data-testid="exp-check"
                disabled={busy}
                onClick={() => void check()}
              >
                Check results
              </Button>
              <Button
                type="button"
                variant="secondary"
                data-testid="exp-override"
                disabled={busy}
                onClick={() => void override()}
              >
                Override → supported
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="exp-edit-version"
                disabled={busy}
                onClick={() => void saveDraft()}
              >
                Edit (new version)
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
