"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ROLES = [
  { id: "council_member", label: "Council member" },
  { id: "synthesizer", label: "Synthesizer" },
  { id: "scribe", label: "Scribe" },
  { id: "evidence", label: "Evidence" },
  { id: "experiment_designer", label: "Experiment designer" },
  { id: "results_interpreter", label: "Results interpreter" },
] as const;

type RoleData = {
  override: string | null;
  default: string;
  effective: string;
};

export function InstructionsSettings() {
  const [global, setGlobal] = React.useState("");
  const [agents, setAgents] = React.useState("");
  const [roles, setRoles] = React.useState<Record<string, RoleData>>({});
  const [activeRole, setActiveRole] = React.useState<string>(ROLES[0]!.id);
  const [roleDraft, setRoleDraft] = React.useState("");

  const load = React.useCallback(async () => {
    const [gRes, aRes, rRes] = await Promise.all([
      fetch("/api/settings/instructions"),
      fetch("/api/projects/agents"),
      fetch("/api/projects/instructions"),
    ]);
    if (gRes.ok) {
      const g = (await gRes.json()) as { global: string };
      setGlobal(g.global ?? "");
    }
    if (aRes.ok) {
      const a = (await aRes.json()) as { content: string };
      setAgents(a.content ?? "");
    }
    if (rRes.ok) {
      const r = (await rRes.json()) as { roles: Record<string, RoleData> };
      setRoles(r.roles);
      const cur = r.roles[activeRole];
      setRoleDraft(cur?.override ?? cur?.default ?? "");
    }
  }, [activeRole]);

  React.useEffect(() => {
    const boot = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(boot);
  }, [load]);

  async function saveGlobal() {
    const res = await fetch("/api/settings/instructions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ global }),
    });
    if (!res.ok) {
      toast.error("Could not save global instructions");
      return;
    }
    toast.success("Global instructions saved");
  }

  async function saveAgents() {
    const res = await fetch("/api/projects/agents", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: agents }),
    });
    if (!res.ok) {
      toast.error("Could not save AGENTS.md");
      return;
    }
    toast.success("Project AGENTS.md saved");
  }

  async function saveRole() {
    const res = await fetch("/api/projects/instructions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "setRole",
        role: activeRole,
        content: roleDraft,
      }),
    });
    if (!res.ok) {
      toast.error("Could not save role override");
      return;
    }
    toast.success("Role override saved");
    await load();
  }

  async function resetRole() {
    const res = await fetch("/api/projects/instructions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "resetRole",
        role: activeRole,
      }),
    });
    if (!res.ok) {
      toast.error("Could not reset role");
      return;
    }
    toast.success("Role reset to default");
    await load();
  }

  const hasOverride = Boolean(roles[activeRole]?.override);

  return (
    <div className="space-y-5" data-testid="instructions-settings">
      <div className="space-y-2">
        <Label htmlFor="global-instructions">Global instructions</Label>
        <p className="text-muted-foreground text-xs">
          Applies to all projects (Settings → Instructions).
        </p>
        <Textarea
          id="global-instructions"
          rows={4}
          className="font-mono text-xs"
          value={global}
          onChange={(e) => setGlobal(e.target.value)}
        />
        <Button type="button" size="sm" onClick={() => void saveGlobal()}>
          Save global
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-agents">Project AGENTS.md</Label>
        <p className="text-muted-foreground text-xs">
          Domain rules and rigor for this project (.research/AGENTS.md).
        </p>
        <Textarea
          id="project-agents"
          data-testid="project-agents-editor"
          rows={8}
          className="font-mono text-xs"
          value={agents}
          onChange={(e) => setAgents(e.target.value)}
        />
        <Button type="button" size="sm" onClick={() => void saveAgents()}>
          Save AGENTS.md
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Role prompts</Label>
        <p className="text-muted-foreground text-xs">
          Override built-in role prompts for this project only.
        </p>
        <select
          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          value={activeRole}
          onChange={(e) => {
            const id = e.target.value;
            setActiveRole(id);
            const rd = roles[id];
            setRoleDraft(rd?.override ?? rd?.default ?? "");
          }}
          aria-label="Select role"
        >
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
              {roles[r.id]?.override ? " (custom)" : ""}
            </option>
          ))}
        </select>
        <Textarea
          rows={6}
          className="font-mono text-xs"
          data-testid="role-override"
          value={roleDraft}
          onChange={(e) => setRoleDraft(e.target.value)}
          aria-label="Role prompt override"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void saveRole()}>
            Save role
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="role-reset"
            disabled={!hasOverride}
            onClick={() => void resetRole()}
          >
            Reset to default
          </Button>
        </div>
      </div>
    </div>
  );
}
