"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type Milestone = {
  id: string;
  title: string;
  goal: string;
  status: string;
};
type Task = {
  id: string;
  title: string;
  description: string;
  owner: string;
  status: string;
  milestoneId: string | null;
};
type Suggestion = {
  id: string;
  kind: string;
  payload: string;
  reason: string;
};

const STATUSES = ["todo", "doing", "blocked", "done"] as const;

export function PlanPanel({
  onRunTask,
}: {
  onRunTask?: (prefill: { message: string; preferCouncil: boolean }) => void;
}) {
  const [milestones, setMilestones] = React.useState<Milestone[]>([]);
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [title, setTitle] = React.useState("");
  const [view, setView] = React.useState<"list" | "board">("board");

  const load = React.useCallback(async () => {
    const res = await fetch("/api/plan");
    if (!res.ok) return;
    const data = (await res.json()) as {
      milestones: Milestone[];
      tasks: Task[];
      suggestions: Suggestion[];
    };
    setMilestones(data.milestones);
    setTasks(data.tasks);
    setSuggestions(data.suggestions);
  }, []);

  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Plan update failed");
      return null;
    }
    return res.json();
  }

  async function addTask() {
    if (!title.trim()) return;
    await post({ action: "createTask", title: title.trim() });
    setTitle("");
    await load();
  }

  async function move(id: string, status: string) {
    await post({ action: "updateTask", id, status });
    await load();
  }

  async function run(id: string) {
    const data = (await post({ action: "runTask", id })) as {
      message?: string;
      preferCouncil?: boolean;
    } | null;
    if (data?.message) {
      onRunTask?.({
        message: data.message,
        preferCouncil: Boolean(data.preferCouncil),
      });
      toast.success("Task opened in chat");
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3" data-testid="plan-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Plan</h2>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={view === "list" ? "default" : "outline"}
            onClick={() => setView("list")}
          >
            List
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "board" ? "default" : "outline"}
            onClick={() => setView("board")}
            data-testid="plan-board-tab"
          >
            Board
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="New task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="plan-task-title"
        />
        <Button type="button" size="sm" onClick={() => void addTask()}>
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="plan-add-milestone"
          onClick={() => {
            const t = window.prompt("Milestone title");
            if (!t?.trim()) return;
            void post({ action: "createMilestone", title: t.trim() }).then(() =>
              load(),
            );
          }}
        >
          Milestone
        </Button>
      </div>

      {suggestions.length ? (
        <div className="space-y-1" data-testid="plan-suggestions">
          {suggestions.map((s) => {
            let label = s.kind;
            try {
              label = String(
                (JSON.parse(s.payload) as { title?: string }).title ?? s.kind,
              );
            } catch {
              /* */
            }
            return (
              <div
                key={s.id}
                className="border-border flex items-center gap-2 rounded border px-2 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  Suggested {s.kind}: {label}
                </span>
                <Button
                  type="button"
                  size="sm"
                  data-testid="plan-accept-suggestion"
                  onClick={() =>
                    void post({ action: "acceptSuggestion", id: s.id }).then(
                      () => load(),
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void post({ action: "dismissSuggestion", id: s.id }).then(
                      () => load(),
                    )
                  }
                >
                  Dismiss
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        {view === "list" ? (
          <ul className="space-y-2 text-sm">
            {milestones.map((m) => (
              <li key={m.id} className="font-medium">
                {m.title}
              </li>
            ))}
            {tasks.map((t) => (
              <li
                key={t.id}
                className="border-border flex items-center gap-2 rounded border px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate">
                  [{t.status}] {t.title}
                </span>
                {t.owner === "team" ? (
                  <Button
                    type="button"
                    size="sm"
                    data-testid="plan-run-task"
                    onClick={() => void run(t.id)}
                  >
                    Run
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            data-testid="plan-board"
          >
            {STATUSES.map((status) => (
              <div key={status} className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase">
                  {status}
                </p>
                {tasks
                  .filter((t) => t.status === status)
                  .map((t) => (
                    <div
                      key={t.id}
                      className="border-border space-y-1 rounded border p-2 text-xs"
                      data-testid="plan-card"
                    >
                      <p className="font-medium">{t.title}</p>
                      <div className="flex flex-wrap gap-1">
                        {STATUSES.filter((s) => s !== status).map((s) => (
                          <Button
                            key={s}
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1 text-[10px]"
                            onClick={() => void move(t.id, s)}
                          >
                            → {s}
                          </Button>
                        ))}
                        {t.owner === "team" ? (
                          <Button
                            type="button"
                            size="sm"
                            className="h-6"
                            data-testid="plan-run-task"
                            onClick={() => void run(t.id)}
                          >
                            Run
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
