"use client";

import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  DEFAULT_ONBOARDING_STATE,
  ONBOARDING_STEPS,
  isTourStep,
  stepIndex,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/onboarding-types";

type OnboardingWizardProps = {
  open: boolean;
  onComplete: () => void;
  onOpenProject: () => void;
  onNewProject?: () => void;
  onOpenSettingsTools?: () => void;
};

type EstimateSlice = {
  totalLowUsd: number;
  totalHighUsd: number;
};

const STATIC_ESTIMATES: Record<"balanced" | "budget", EstimateSlice> = {
  balanced: { totalLowUsd: 0.02, totalHighUsd: 0.09 },
  budget: { totalLowUsd: 0.005, totalHighUsd: 0.025 },
};

async function patchOnboarding(
  body: Record<string, unknown>,
): Promise<{ state: OnboardingState; isComplete: boolean }> {
  const res = await fetch("/api/onboarding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("onboarding update failed");
  return (await res.json()) as { state: OnboardingState; isComplete: boolean };
}

function ProgressDots({ step }: { step: OnboardingStep }) {
  const idx = stepIndex(step);
  return (
    <div
      className="flex flex-wrap gap-1"
      aria-label={`Step ${idx + 1} of ${ONBOARDING_STEPS.length}`}
    >
      {ONBOARDING_STEPS.map((s, i) => (
        <span
          key={s}
          className={
            i <= idx
              ? "bg-primary h-1.5 w-1.5 rounded-full"
              : "bg-muted-foreground/30 h-1.5 w-1.5 rounded-full"
          }
        />
      ))}
    </div>
  );
}

export function OnboardingWizard({
  open,
  onComplete,
  onOpenProject,
  onNewProject,
  onOpenSettingsTools,
}: OnboardingWizardProps) {
  const [state, setState] = React.useState<OnboardingState>(
    DEFAULT_ONBOARDING_STATE,
  );
  const [busy, setBusy] = React.useState(false);
  const [hasKey, setHasKey] = React.useState(false);
  const [hasProject, setHasProject] = React.useState(false);
  const [keyValue, setKeyValue] = React.useState("");
  const [preset, setPreset] = React.useState<"balanced" | "budget" | null>(
    null,
  );
  const [estimates, setEstimates] =
    React.useState<Record<"balanced" | "budget", EstimateSlice>>(
      STATIC_ESTIMATES,
    );
  const [embedder, setEmbedder] = React.useState<{
    state: string;
    progress?: number;
    reason?: string;
  } | null>(null);

  const step = state.step;

  const refreshHints = React.useCallback(async () => {
    try {
      const [secretsRes, projectsRes] = await Promise.all([
        fetch("/api/secrets"),
        fetch("/api/projects"),
      ]);
      if (secretsRes.ok) {
        const secrets = (await secretsRes.json()) as Array<{
          name: string;
          set: boolean;
        }>;
        setHasKey(
          secrets.find((s) => s.name === "openrouter_api_key")?.set ?? false,
        );
      }
      if (projectsRes.ok) {
        const projects = (await projectsRes.json()) as {
          current: { id: string } | null;
        };
        setHasProject(Boolean(projects.current));
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/onboarding");
        if (!res.ok) return;
        const data = (await res.json()) as {
          state: OnboardingState;
          isComplete: boolean;
        };
        if (cancelled) return;
        if (data.isComplete) {
          onComplete();
          return;
        }
        setState(data.state);
      } catch {
        // ignore
      }
      if (!cancelled) await refreshHints();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onComplete, refreshHints]);

  React.useEffect(() => {
    if (!open || step !== "preset") return;
    let cancelled = false;
    void (async () => {
      const nextEst = { ...STATIC_ESTIMATES };
      for (const id of ["balanced", "budget"] as const) {
        try {
          await fetch("/api/council/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applyPreset: id }),
          });
          const res = await fetch("/api/council/estimate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contextChars: 4000 }),
          });
          if (!res.ok) continue;
          const data = (await res.json()) as { estimate?: EstimateSlice };
          if (data.estimate && !cancelled) {
            nextEst[id] = {
              totalLowUsd: data.estimate.totalLowUsd,
              totalHighUsd: data.estimate.totalHighUsd,
            };
          }
        } catch {
          // keep static
        }
      }
      if (!cancelled) setEstimates(nextEst);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step]);

  React.useEffect(() => {
    if (!open || step !== "memory") return;
    let cancelled = false;
    void fetch("/api/memory/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rebuild: true }),
    }).catch(() => undefined);

    const poll = async () => {
      try {
        const res = await fetch("/api/memory/config");
        if (!res.ok) return;
        const data = (await res.json()) as {
          embedder: {
            state: string;
            progress?: number;
            reason?: string;
          };
        };
        if (!cancelled) setEmbedder(data.embedder);
      } catch {
        // ignore
      }
    };
    void poll();
    const t = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [open, step]);

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const data = await patchOnboarding(body);
      setState(data.state);
      if (data.isComplete) onComplete();
    } catch {
      toast.error("Could not update onboarding");
    } finally {
      setBusy(false);
    }
  };

  async function saveKey() {
    const trimmed = keyValue.trim();
    if (!trimmed) {
      toast.error("Paste a key or connect with OpenRouter");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "openrouter_api_key", value: trimmed }),
      });
      if (!res.ok) throw new Error("save failed");
      setKeyValue("");
      await refreshHints();
      toast.success("Key saved");
    } catch {
      toast.error("Failed to save key");
    } finally {
      setBusy(false);
    }
  }

  const applyPreset = async (id: "balanced" | "budget") => {
    setPreset(id);
    try {
      const res = await fetch("/api/council/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyPreset: id }),
      });
      if (!res.ok) toast.error("Could not apply preset");
    } catch {
      toast.error("Could not apply preset");
    }
  };

  const titles: Record<OnboardingStep, string> = {
    welcome: "Welcome to Araitchi",
    connect: "Connect OpenRouter",
    project: "Open a project",
    preset: "Council preset",
    memory: "Memory model",
    tour_mode: "Tour · modes",
    tour_memory: "Tour · memory",
    tour_tools: "Tour · tools",
    tour_validation: "Tour · validation",
  };

  const progress = Math.round(embedder?.progress ?? 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void run({ action: "skip" });
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-testid="onboarding-wizard"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{titles[step]}</DialogTitle>
          <DialogDescription>
            First-run setup · step {stepIndex(step) + 1} of{" "}
            {ONBOARDING_STEPS.length}
          </DialogDescription>
        </DialogHeader>

        <ProgressDots step={step} />

        <div className="mt-2 min-h-[8rem]">
          {step === "welcome" ? (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed">
                Araitchi is a local research workspace: multi-model council,
                project memory, literature tools, and a validation loop — billed
                through your OpenRouter account.
              </p>
              <p className="text-muted-foreground text-xs">
                This short setup is skippable. You can change everything later
                in Settings.
              </p>
            </div>
          ) : null}

          {step === "connect" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">Connect OpenRouter to run models.</p>
                <Badge variant={hasKey ? "default" : "secondary"}>
                  {hasKey ? "Connected" : "Not set"}
                </Badge>
              </div>
              <Button type="button" asChild>
                <a href="/api/openrouter/connect">Connect with OpenRouter</a>
              </Button>
              <div className="space-y-2">
                <Label htmlFor="onboarding-or-key">Or paste an API key</Label>
                <Input
                  id="onboarding-or-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasKey ? "••••••••••••" : "Paste API key"}
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void saveKey()}
                >
                  Save key
                </Button>
              </div>
            </div>
          ) : null}

          {step === "project" ? (
            <div className="space-y-4">
              <p className="text-sm">
                Open a research folder or create a new project. A scratch
                workspace is fine to start.
              </p>
              <Badge variant={hasProject ? "default" : "secondary"}>
                {hasProject ? "Project ready" : "No project yet"}
              </Badge>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    onOpenProject();
                    void refreshHints();
                  }}
                >
                  Open folder
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    (onNewProject ?? onOpenProject)();
                    void refreshHints();
                  }}
                >
                  New project
                </Button>
              </div>
            </div>
          ) : null}

          {step === "preset" ? (
            <div className="space-y-4">
              <p className="text-sm">
                Pick a council preset. Estimates are approximate cost per
                council reply.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["balanced", "Balanced"],
                    ["budget", "Budget"],
                  ] as const
                ).map(([id, label]) => {
                  const est = estimates[id];
                  const active = preset === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid={`onboarding-preset-${id}`}
                      className={
                        active
                          ? "border-primary bg-primary/5 rounded-xl border p-3 text-left"
                          : "hover:bg-muted/40 rounded-xl border p-3 text-left"
                      }
                      onClick={() => void applyPreset(id)}
                    >
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        ~${est.totalLowUsd.toFixed(3)}–$
                        {est.totalHighUsd.toFixed(3)} / reply
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === "memory" ? (
            <div className="space-y-4">
              <p className="text-sm">
                Local memory uses an embedding model (~610 MB, one-time).
                Keyword search still works if download is skipped.
              </p>
              {embedder?.state === "downloading" ? (
                <div
                  className="space-y-2"
                  data-testid="onboarding-memory-progress"
                >
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Downloading… {progress}%
                  </p>
                </div>
              ) : embedder?.state === "unavailable" ? (
                <p className="text-destructive text-sm">
                  Memory search is keyword-only
                  {embedder.reason ? `: ${embedder.reason}` : ""}.
                </p>
              ) : (
                <p className="text-sm" data-testid="onboarding-memory-ready">
                  Memory model ready (or using the lightweight / fake embedder).
                </p>
              )}
            </div>
          ) : null}

          {step === "tour_mode" ? (
            <div className="space-y-3" data-testid="onboarding-tour-tour_mode">
              <p className="text-sm font-medium">Mode switch</p>
              <p className="text-sm leading-relaxed">
                Use Solo, Auto, or Council in the top bar. Auto convenes the
                council when the gate says the question is hard enough.
              </p>
            </div>
          ) : null}
          {step === "tour_memory" ? (
            <div
              className="space-y-3"
              data-testid="onboarding-tour-tour_memory"
            >
              <p className="text-sm font-medium">Memory panel</p>
              <p className="text-sm leading-relaxed">
                The right-hand panel holds hypotheses, findings, and notes.
                Expand it anytime; scribe can file facts after replies.
              </p>
            </div>
          ) : null}
          {step === "tour_tools" ? (
            <div className="space-y-3" data-testid="onboarding-tour-tour_tools">
              <p className="text-sm font-medium">Tools toggles</p>
              <p className="text-sm leading-relaxed">
                Settings → Tools turns literature search, repo read, and other
                brokers on or off per project.
              </p>
              {onOpenSettingsTools ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onOpenSettingsTools}
                >
                  Open tools settings
                </Button>
              ) : null}
            </div>
          ) : null}
          {step === "tour_validation" ? (
            <div
              className="space-y-3"
              data-testid="onboarding-tour-tour_validation"
            >
              <p className="text-sm font-medium">Validation loop</p>
              <p className="text-sm leading-relaxed">
                Design an experiment, lock predictions, then check results — so
                you do not peek before you predict.
              </p>
            </div>
          ) : null}
          {isTourStep(step) ? null : null}
        </div>

        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid="onboarding-skip"
            onClick={() => void run({ action: "skip" })}
          >
            Skip setup
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || step === "welcome"}
              data-testid="onboarding-back"
              onClick={() => void run({ action: "back" })}
            >
              Back
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              data-testid="onboarding-next"
              onClick={() =>
                void run({
                  action: step === "tour_validation" ? "complete" : "next",
                })
              }
            >
              {step === "tour_validation" ? "Finish" : "Continue"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
