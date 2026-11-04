"use client";

import { useChat } from "@ai-sdk/react";
import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { UIMessage } from "ai";
import {
  ArrowDown,
  BookmarkPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  SendHorizontal,
  Square,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import {
  CouncilMessage,
  type CouncilAnalysisView,
  type CouncilMemberView,
  type CouncilSummaryView,
} from "@/components/chat/council-message";
import { ApprovalDialog } from "@/components/chat/approval-dialog";
import { Markdown } from "@/components/chat/markdown";
import { ModelPicker } from "@/components/chat/model-picker";
import { ReasoningBlock } from "@/components/chat/reasoning-block";
import { SaveToMemoryDialog } from "@/components/chat/save-to-memory-dialog";
import { CitationBadges } from "@/components/chat/citation-badges";
import { SourcesSection } from "@/components/chat/sources-section";
import { TraceabilityView } from "@/components/chat/traceability-view";
import {
  phaseFromCouncil,
  phaseFromToolCalls,
  ThinkingStatus,
  type ThinkingPhase,
} from "@/components/chat/thinking-status";
import { ToolCard } from "@/components/chat/tool-card";
import { AgentsSuggestions } from "@/components/chat/agents-suggestions";
import {
  ContextIndicator,
  type ContextItem,
} from "@/components/chat/context-indicator";
import {
  MemoryLine,
  type ScribeSummaryData,
} from "@/components/chat/memory-line";
import { ReadCompleteness } from "@/components/chat/read-completeness";
import { ScribeSuggestions } from "@/components/chat/scribe-suggestions";
import { GateChip, type GateChipData } from "@/components/chat/gate-chip";
import type { ChatMode } from "@/components/shell/mode-switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getBranchMeta, type StoredMessage } from "@/lib/chat/branches";
import { extractToolCalls, type ToolCallView } from "@/lib/chat/tool-events";
import { cn } from "cn";

type ChatPanelProps = {
  chatId: string;
  hasKey: boolean;
  mode: ChatMode;
  onOpenSettings: (
    tab?:
      | "keys"
      | "models"
      | "council"
      | "tools"
      | "memory"
      | "instructions"
      | "routing",
  ) => void;
  onChatUpdated?: () => void;
  onMemorySaved?: () => void;
};

type ToolToggleState = {
  papers: boolean;
  web: boolean;
  documents: boolean;
  repo: boolean;
  mcp: boolean;
  memory: boolean;
};

const TOOL_TOGGLE_LABELS: { key: keyof ToolToggleState; label: string }[] = [
  { key: "papers", label: "Papers" },
  { key: "web", label: "Web" },
  { key: "documents", label: "Documents" },
  { key: "repo", label: "Repo" },
  { key: "mcp", label: "MCP" },
  { key: "memory", label: "Memory" },
];

const DEFAULT_TOGGLES: ToolToggleState = {
  papers: true,
  web: true,
  documents: false,
  repo: false,
  mcp: false,
  memory: true,
};

type MessageMeta = {
  modelId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    scribeCost?: number;
  };
};

function storedToUi(messages: StoredMessage[]): UIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: (m.parts as UIMessage["parts"]) ?? [],
    metadata: {
      modelId: m.modelId ?? undefined,
      usage: m.usage ?? undefined,
    } satisfies MessageMeta,
  }));
}

function extractText(message: UIMessage): string {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function extractReasoning(message: UIMessage): string {
  return message.parts
    .map((p) =>
      p.type === "reasoning" && "text" in p
        ? String((p as { text?: string }).text ?? "")
        : "",
    )
    .join("");
}

function isCouncilMessage(message: UIMessage): boolean {
  return message.parts.some(
    (p) =>
      typeof p.type === "string" &&
      (p.type === "data-council-summary" || p.type === "data-member"),
  );
}

function modelLabel(modelId?: string): { initial: string; name: string } {
  if (!modelId) return { initial: "A", name: "Assistant" };
  const [lab, ...rest] = modelId.split("/");
  const name = rest.join("/") || modelId;
  return { initial: (lab?.[0] ?? "A").toUpperCase(), name };
}

function parseCouncilFromParts(parts: UIMessage["parts"]): {
  members: CouncilMemberView[];
  analysis: CouncilAnalysisView | null;
  summary: CouncilSummaryView | null;
  finalAnswer: string;
  synthesizing: boolean;
} {
  const membersMap = new Map<string, CouncilMemberView>();
  let analysis: CouncilAnalysisView | null = null;
  let summary: CouncilSummaryView | null = null;
  let finalAnswer = "";
  let synthesizing = false;

  for (const p of parts) {
    if (p.type === "text") finalAnswer += p.text;
    if (p.type === "data-analysis" && "data" in p) {
      analysis = p.data as CouncilAnalysisView;
    }
    if (p.type === "data-council-summary" && "data" in p) {
      summary = p.data as CouncilSummaryView;
    }
    if (p.type === "data-synthesis") {
      synthesizing = true;
    }
    if (p.type === "data-member" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      const modelId = String(d.modelId ?? "");
      if (!modelId) continue;
      const prev = membersMap.get(modelId);
      const streamingText =
        d.phase === "delta"
          ? `${prev?.streamingText ?? prev?.content ?? ""}${String(d.text ?? "")}`
          : prev?.streamingText;
      membersMap.set(modelId, {
        modelId,
        lab: typeof d.lab === "string" ? d.lab : prev?.lab,
        content:
          typeof d.content === "string"
            ? d.content
            : streamingText || prev?.content || "",
        status: String(
          d.status ??
            (d.phase === "error"
              ? "failed"
              : d.phase === "substituted"
                ? "substituted"
                : d.phase === "finish"
                  ? "done"
                  : "streaming"),
        ),
        cost: typeof d.cost === "number" ? d.cost : prev?.cost,
        latencyMs:
          typeof d.latencyMs === "number" ? d.latencyMs : prev?.latencyMs,
        usage: (d.usage as CouncilMemberView["usage"]) ?? prev?.usage,
        substitutedFrom:
          (d.substitutedFrom as string | null | undefined) ??
          prev?.substitutedFrom,
        error: (d.error as string | null | undefined) ?? prev?.error,
        streamingText:
          d.phase === "finish" || d.phase === "error"
            ? undefined
            : streamingText,
      });
    }
  }

  return {
    members: [...membersMap.values()],
    analysis,
    summary,
    finalAnswer: finalAnswer || analysis?.finalAnswer || "",
    synthesizing,
  };
}

function extractScribe(parts: UIMessage["parts"]): ScribeSummaryData | null {
  for (const p of parts) {
    if (p.type === "data-scribe" && "data" in p) {
      return p.data as ScribeSummaryData;
    }
  }
  return null;
}

function extractGate(parts: UIMessage["parts"]): GateChipData | null {
  for (const p of parts) {
    if (p.type === "data-gate" && "data" in p) {
      return p.data as GateChipData;
    }
  }
  return null;
}

function extractTrust(parts: UIMessage["parts"]): {
  citations: import("@/lib/server/citations/types").CitationSummary;
  summaryLine: string;
  traceFooter: string;
  claimMap: { sentence: string; markers: string[] }[];
  sourcedCount: number;
  sentenceCount: number;
} | null {
  for (const p of parts) {
    if (p.type === "data-trust" && "data" in p) {
      return p.data as {
        citations: import("@/lib/server/citations/types").CitationSummary;
        summaryLine: string;
        traceFooter: string;
        claimMap: { sentence: string; markers: string[] }[];
        sourcedCount: number;
        sentenceCount: number;
      };
    }
  }
  return null;
}

function resolvePhase(input: {
  toolCalls: ToolCallView[];
  council: ReturnType<typeof parseCouncilFromParts> | null;
  hasAnswerText: boolean;
}): ThinkingPhase {
  if (input.hasAnswerText) return { kind: "thinking" };
  if (input.council) {
    const done = input.council.members.filter(
      (m) =>
        m.status === "done" ||
        m.status === "failed" ||
        m.status === "substituted",
    ).length;
    const councilPhase = phaseFromCouncil({
      memberCount: input.council.members.length,
      doneCount: done,
      synthesizing: input.council.synthesizing,
      hasFinalAnswer: Boolean(input.council.finalAnswer.trim()),
    });
    if (councilPhase) return councilPhase;
  }
  const toolPhase = phaseFromToolCalls(input.toolCalls);
  if (toolPhase) return toolPhase;
  return { kind: "thinking" };
}

export function ChatPanel({
  chatId,
  hasKey,
  mode,
  onOpenSettings,
  onChatUpdated,
  onMemorySaved,
}: ChatPanelProps) {
  const [modelId, setModelId] = React.useState<string | null>(null);
  const [input, setInput] = React.useState("");
  const [allStored, setAllStored] = React.useState<StoredMessage[]>([]);
  const [activeLeafId, setActiveLeafId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [showScrollBtn, setShowScrollBtn] = React.useState(false);
  const [pinnedCount, setPinnedCount] = React.useState(0);
  const [relevantCount, setRelevantCount] = React.useState(0);
  const [contextTokens, setContextTokens] = React.useState(0);
  const [contextItems, setContextItems] = React.useState<ContextItem[]>([]);
  const [vectorUsed, setVectorUsed] = React.useState(true);
  const [layerIds, setLayerIds] = React.useState<string[]>([]);
  const [handoffNote, setHandoffNote] = React.useState<string | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveBody, setSaveBody] = React.useState("");
  const [saveSource, setSaveSource] = React.useState("user");
  const [saveMessageId, setSaveMessageId] = React.useState<string | null>(null);
  const [saveType, setSaveType] = React.useState<
    "hypothesis" | "experiment" | "decision" | "paper" | "question" | "note"
  >("note");
  const [allowOverBudget, setAllowOverBudget] = React.useState(false);
  const [overBudgetOpen, setOverBudgetOpen] = React.useState(false);
  const [estimateLabel, setEstimateLabel] = React.useState<string | null>(null);
  const [councilChip, setCouncilChip] = React.useState("Council");
  const [overBudget, setOverBudget] = React.useState(false);
  const [toggles, setToggles] =
    React.useState<ToolToggleState>(DEFAULT_TOGGLES);
  const [approvals, setApprovals] = React.useState<Record<string, boolean>>({});
  const [pendingApproval, setPendingApproval] =
    React.useState<ToolCallView | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const transport = React.useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          messages,
          id,
          body,
          trigger,
          messageId,
        }) => ({
          body: {
            id,
            messages,
            trigger,
            messageId,
            chatId,
            ...(modelId ? { modelId } : {}),
            mode,
            allowOverBudget,
            tools: toggles,
            ...body,
          },
        }),
      }),
    [chatId, modelId, mode, allowOverBudget, toggles],
  );

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    error,
  } = useChat({
    id: chatId,
    transport,
    onFinish: () => {
      onChatUpdated?.();
      void (async () => {
        // Scribe may finish just after the stream; poll briefly for data-scribe.
        for (let i = 0; i < 8; i++) {
          const res = await fetch(`/api/chats/${chatId}`);
          if (!res.ok) return;
          const data = (await res.json()) as {
            messages: StoredMessage[];
            activeLeafId?: string | null;
          };
          setAllStored(data.messages);
          setMessages(storedToUi(data.messages));
          if (data.activeLeafId) setActiveLeafId(data.activeLeafId);
          const hasScribe = data.messages.some((m) =>
            (m.parts as { type?: string }[]).some(
              (p) => p.type === "data-scribe",
            ),
          );
          if (hasScribe || i === 7) {
            onMemorySaved?.();
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      })();
    },
    onError: (err) => {
      toast.error(err.message || "Chat request failed");
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const [streamStartedAt, setStreamStartedAt] = React.useState<number | null>(
    null,
  );
  const [streamNow, setStreamNow] = React.useState(() => Date.now());
  const thoughtSeconds =
    streamStartedAt != null
      ? Math.max(1, Math.floor((streamNow - streamStartedAt) / 1000) || 1)
      : 1;

  React.useEffect(() => {
    if (!isStreaming) {
      const t = window.setTimeout(() => setStreamStartedAt(null), 0);
      return () => window.clearTimeout(t);
    }
    const start = Date.now();
    const boot = window.setTimeout(() => {
      setStreamStartedAt(start);
      setStreamNow(start);
    }, 0);
    const id = window.setInterval(() => setStreamNow(Date.now()), 250);
    return () => {
      window.clearTimeout(boot);
      window.clearInterval(id);
    };
  }, [isStreaming]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/chats/${chatId}`);
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        messages: StoredMessage[];
        activeBranch: StoredMessage[];
      };
      if (cancelled) return;
      setAllStored(data.messages);
      setMessages(storedToUi(data.activeBranch));
      setActiveLeafId(data.activeBranch.at(-1)?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, setMessages]);

  React.useEffect(() => {
    if (!hasKey) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/tools/config");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { toggles?: Partial<ToolToggleState> };
      if (!cancelled && data.toggles) {
        setToggles((prev) => ({ ...prev, ...data.toggles }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, hasKey]);

  async function toggleTool(key: keyof ToolToggleState) {
    const next = !toggles[key];
    setToggles((prev) => ({ ...prev, [key]: next }));
    const res = await fetch("/api/tools/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggles: { [key]: next } }),
    });
    if (!res.ok) {
      setToggles((prev) => ({ ...prev, [key]: !next }));
      toast.error("Could not save tool setting");
    }
  }

  function decideApproval(call: ToolCallView, approved: boolean) {
    setPendingApproval(null);
    if (!call.approvalKey) return;
    const next = { ...approvals, [call.approvalKey]: approved };
    setApprovals(next);
    if (approved) {
      void regenerate({ body: { toolApprovals: next } });
    }
  }

  React.useEffect(() => {
    if (isStreaming) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isStreaming]);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, [chatId, hasKey]);

  React.useEffect(() => {
    let cancelled = false;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const qText = lastUser
      ? extractText(lastUser).slice(0, 300)
      : input.slice(0, 300);
    const handle = window.setTimeout(() => {
      void (async () => {
        const q = encodeURIComponent(qText);
        const res = await fetch(
          `/api/projects/context?chatId=${encodeURIComponent(chatId)}&q=${q}`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          pinnedCount: number;
          relevantCount?: number;
          totalTokens?: number;
          items?: ContextItem[];
          vectorUsed?: boolean;
          layerIds?: string[];
          handoffNote?: string | null;
        };
        if (cancelled) return;
        setPinnedCount(data.pinnedCount);
        setRelevantCount(data.relevantCount ?? 0);
        setContextTokens(data.totalTokens ?? 0);
        setContextItems(data.items ?? []);
        setVectorUsed(data.vectorUsed !== false);
        setLayerIds(data.layerIds ?? []);
        setHandoffNote(data.handoffNote ?? null);
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [chatId, onMemorySaved, messages, input]);

  const refreshEstimate = React.useCallback(async () => {
    if (mode !== "council") {
      setEstimateLabel(null);
      return;
    }
    const res = await fetch("/api/council/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messagesText: input }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      estimate: { totalLowUsd: number; totalHighUsd: number };
      config: {
        members: string[];
        budgetCapUsd: number;
        preset: string;
      };
      overBudget: boolean;
    };
    setOverBudget(data.overBudget);
    setEstimateLabel(
      `≈ $${data.estimate.totalLowUsd.toFixed(2)}–${data.estimate.totalHighUsd.toFixed(2)} · cap $${data.config.budgetCapUsd.toFixed(2)}`,
    );
    const presetLabel =
      data.config.preset === "balanced"
        ? "Balanced"
        : data.config.preset === "budget"
          ? "Budget"
          : "Custom";
    setCouncilChip(`${data.config.members.length} models · ${presetLabel}`);
  }, [mode, input]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- estimate fetch
    void refreshEstimate();
  }, [refreshEstimate]);

  function openSaveToMemory(message: UIMessage, selected?: string) {
    const text = selected?.trim() || extractText(message);
    const meta = (message.metadata ?? {}) as MessageMeta;
    const stored = allStored.find((m) => m.id === message.id);
    const source =
      message.role === "assistant"
        ? stored?.modelId || meta.modelId || modelId || "assistant"
        : "user";
    setSaveBody(text);
    setSaveSource(source);
    setSaveMessageId(message.id);
    setSaveOpen(true);
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(dist > 120);
  }

  async function switchBranch(messageId: string, direction: -1 | 1) {
    const meta = getBranchMeta(allStored, messageId);
    if (meta.total <= 1) return;
    const msg = allStored.find((m) => m.id === messageId);
    if (!msg) return;
    const siblings = allStored
      .filter((m) => m.parentId === msg.parentId && m.role === msg.role)
      .sort((a, b) => a.createdAt - b.createdAt);
    const idx = siblings.findIndex((s) => s.id === messageId);
    const next = siblings[idx + direction];
    if (!next) return;

    const res = await fetch(
      `/api/chats/${chatId}?leaf=${encodeURIComponent(next.id)}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      activeBranch: StoredMessage[];
      messages: StoredMessage[];
    };
    setAllStored(data.messages);
    setMessages(storedToUi(data.activeBranch));
    setActiveLeafId(data.activeBranch.at(-1)?.id ?? next.id);
  }

  async function handleSend(force = false) {
    const text = input.trim();
    if (!text || isStreaming || !hasKey) return;
    if (mode === "solo" && !modelId) return;
    if (mode === "council" && overBudget && !force && !allowOverBudget) {
      setOverBudgetOpen(true);
      return;
    }
    setInput("");
    await sendMessage(
      { text },
      {
        body: {
          allowOverBudget: force || allowOverBudget || false,
          mode,
        },
      },
    );
    setAllowOverBudget(false);
    onChatUpdated?.();
  }

  async function handleEditSubmit(original: UIMessage) {
    const text = editText.trim();
    if (!text || !modelId) return;
    setEditingId(null);
    const parentId =
      allStored.find((m) => m.id === original.id)?.parentId ?? null;

    // Truncate UI to before this user message, then send edited as new branch
    const idx = messages.findIndex((m) => m.id === original.id);
    const prior = idx >= 0 ? messages.slice(0, idx) : messages;
    setMessages(prior);

    await sendMessage(
      { text },
      {
        body: { parentId },
      },
    );
    onChatUpdated?.();
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-4"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {messages.length === 0 ? (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center py-16 text-center">
              <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">
                What are you researching?
              </h1>
              <p className="mt-3 max-w-md text-sm leading-relaxed">
                Solo chat is ready. Pick a model and ask anything — costs are
                billed to your OpenRouter account.
              </p>
            </div>
          ) : null}

          {messages.map((message, messageIndex) => {
            const text = extractText(message);
            const reasoning = extractReasoning(message);
            const meta = (message.metadata ?? {}) as MessageMeta;
            const branch = getBranchMeta(allStored, message.id);
            const council = isCouncilMessage(message)
              ? parseCouncilFromParts(message.parts)
              : null;
            const toolCalls =
              message.role === "assistant"
                ? extractToolCalls(
                    message.parts as unknown as {
                      type: string;
                      data?: unknown;
                      id?: string;
                    }[],
                  )
                : [];
            const hasReadTool = toolCalls.some((c) =>
              c.tool.toLowerCase().includes("read_file"),
            );
            const isLast = messageIndex === messages.length - 1;
            const isActiveStream =
              isStreaming && isLast && message.role === "assistant" && !error;
            const answerText = council ? council.finalAnswer || text : text;
            const hasAnswerText = Boolean(answerText.trim());
            const phase = resolvePhase({
              toolCalls,
              council,
              hasAnswerText,
            });
            const showStatus = isActiveStream && !hasAnswerText && !error;
            const reasoningStreaming =
              isActiveStream && Boolean(reasoning) && !hasAnswerText;
            const label = modelLabel(meta.modelId ?? modelId ?? undefined);

            return (
              <div
                key={message.id}
                className={cn(
                  "group flex w-full flex-col gap-2",
                  message.role === "user" ? "items-end" : "items-start",
                )}
              >
                {toolCalls.length > 0 ? (
                  <div
                    className="flex w-full flex-col gap-1.5"
                    data-testid="tool-calls"
                  >
                    {toolCalls.map((call) => (
                      <ToolCard
                        key={call.id}
                        call={call}
                        onReview={setPendingApproval}
                      />
                    ))}
                  </div>
                ) : null}

                {council && message.role === "assistant" ? (
                  <CouncilMessage
                    finalAnswer={answerText}
                    members={council.members}
                    analysis={council.analysis}
                    summary={council.summary}
                    streaming={isActiveStream}
                    statusSlot={
                      showStatus ? (
                        <ThinkingStatus
                          phase={phase}
                          startedAt={streamStartedAt ?? undefined}
                        />
                      ) : null
                    }
                    onSaveToMemory={(body, preferredType) => {
                      setSaveBody(body);
                      setSaveSource("council");
                      setSaveMessageId(message.id);
                      setSaveType((preferredType as typeof saveType) || "note");
                      setSaveOpen(true);
                    }}
                  />
                ) : editingId === message.id ? (
                  <div className="bg-muted/40 w-full max-w-[80%] space-y-2 rounded-2xl px-4 py-3">
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="bg-background text-foreground min-w-[280px]"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        type="button"
                        onClick={() => void handleEditSubmit(message)}
                      >
                        Save &amp; branch
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : message.role === "assistant" ? (
                  <div
                    className="w-full"
                    data-variant="open"
                    data-testid="assistant-message"
                  >
                    <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
                      <span className="bg-muted text-foreground inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold">
                        {label.initial}
                      </span>
                      <span className="truncate">{label.name}</span>
                    </div>
                    <ReasoningBlock
                      text={reasoning}
                      streaming={reasoningStreaming}
                      thoughtSeconds={thoughtSeconds}
                    />
                    {showStatus ? (
                      <ThinkingStatus
                        phase={phase}
                        startedAt={streamStartedAt ?? undefined}
                      />
                    ) : hasAnswerText ? (
                      <Markdown content={answerText} />
                    ) : null}
                  </div>
                ) : (
                  <div
                    className="bg-muted max-w-[80%] rounded-2xl px-4 py-2.5"
                    data-variant="bubble"
                    data-testid="user-message"
                  >
                    <p className="text-base leading-[1.7] whitespace-pre-wrap">
                      {text}
                    </p>
                  </div>
                )}

                {toolCalls.length > 0 && !isStreaming ? (
                  <div className="w-full space-y-1">
                    <SourcesSection calls={toolCalls} />
                    {message.role === "assistant" ? (
                      <ReadCompleteness
                        chatId={chatId}
                        messageId={message.id}
                        hasReadTool={hasReadTool}
                      />
                    ) : null}
                  </div>
                ) : null}

                {message.role === "assistant" && !isStreaming
                  ? (() => {
                      const trust = extractTrust(message.parts);
                      if (!trust) return null;
                      return (
                        <div className="w-full">
                          <CitationBadges
                            summary={trust.citations}
                            summaryLine={trust.summaryLine}
                          />
                          <TraceabilityView
                            claimMap={trust.claimMap}
                            sourcedCount={trust.sourcedCount}
                            sentenceCount={trust.sentenceCount}
                            footer={trust.traceFooter}
                          />
                        </div>
                      );
                    })()
                  : null}

                {message.role === "assistant"
                  ? (() => {
                      const gate = extractGate(message.parts);
                      const scribe = extractScribe(message.parts);
                      return (
                        <>
                          {gate ? (
                            <GateChip
                              data={gate}
                              onRerun={(action) => {
                                void regenerate({
                                  body: {
                                    mode:
                                      action === "council" ? "council" : "solo",
                                    forceAction: action,
                                  },
                                });
                              }}
                            />
                          ) : null}
                          {scribe ? (
                            <MemoryLine
                              data={scribe}
                              onUndone={() => onMemorySaved?.()}
                            />
                          ) : null}
                        </>
                      );
                    })()
                  : null}

                <div
                  className={cn(
                    "text-muted-foreground flex flex-wrap items-center gap-1 text-xs transition-opacity",
                    "opacity-100",
                    "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100",
                  )}
                >
                  {branch.total > 1 ? (
                    <div className="mr-1 flex items-center gap-0.5">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Previous branch"
                        disabled={branch.index <= 1}
                        onClick={() => void switchBranch(message.id, -1)}
                      >
                        <ChevronLeft className="size-3.5" />
                      </Button>
                      <span>
                        {branch.index}/{branch.total}
                      </span>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Next branch"
                        disabled={branch.index >= branch.total}
                        onClick={() => void switchBranch(message.id, 1)}
                      >
                        <ChevronRight className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}

                  {message.role === "user" ? (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Edit message"
                      onClick={() => {
                        setEditingId(message.id);
                        setEditText(text);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  ) : null}

                  {message.role === "assistant" ? (
                    <>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Copy message"
                        onClick={async () => {
                          await navigator.clipboard.writeText(answerText);
                          toast.success("Copied");
                        }}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Retry"
                        disabled={isStreaming}
                        onClick={() => void regenerate()}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                    </>
                  ) : null}

                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Save to memory"
                    onClick={() => {
                      const sel = window.getSelection()?.toString();
                      openSaveToMemory(message, sel);
                    }}
                  >
                    <BookmarkPlus className="size-3.5" />
                  </Button>

                  {message.role === "assistant" &&
                  !isStreaming &&
                  (meta.modelId ||
                    meta.usage?.inputTokens != null ||
                    typeof meta.usage?.cost === "number") ? (
                    <span className="text-muted-foreground/80 ml-1 text-[11px]">
                      {[
                        meta.modelId,
                        meta.usage?.inputTokens != null ||
                        meta.usage?.outputTokens != null
                          ? `${meta.usage?.inputTokens ?? 0}→${meta.usage?.outputTokens ?? 0} tok`
                          : null,
                        typeof meta.usage?.cost === "number"
                          ? `$${meta.usage.cost.toFixed(4)}${
                              typeof meta.usage.scribeCost === "number"
                                ? ` + memory $${meta.usage.scribeCost.toFixed(4)}`
                                : ""
                            }`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}

          {isStreaming && !error && messages.at(-1)?.role === "user" ? (
            <div
              className="w-full"
              data-variant="open"
              data-testid="assistant-message"
            >
              <ThinkingStatus
                phase={{ kind: "thinking" }}
                startedAt={streamStartedAt ?? undefined}
              />
            </div>
          ) : null}

          {error ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
              <span>{error.message}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void regenerate()}
              >
                Retry
              </Button>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      {showScrollBtn ? (
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="absolute right-4 bottom-28 rounded-full shadow-md"
          aria-label="Scroll to bottom"
          onClick={() =>
            bottomRef.current?.scrollIntoView({ behavior: "smooth" })
          }
        >
          <ArrowDown className="size-4" />
        </Button>
      ) : null}

      <div className="bg-background/80 supports-[backdrop-filter]:bg-background/60 border-t px-3 py-3 backdrop-blur sm:px-4">
        {!hasKey ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-6 text-center">
            <p className="text-muted-foreground text-sm">
              Connect OpenRouter to start chatting.
            </p>
            <Button type="button" onClick={() => onOpenSettings("keys")}>
              Connect OpenRouter to start
            </Button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-2">
            <ContextIndicator
              pinnedCount={pinnedCount}
              relevantCount={relevantCount}
              totalTokens={contextTokens}
              items={contextItems}
              vectorUsed={vectorUsed}
              layerIds={layerIds}
              handoffNote={handoffNote}
            />
            <AgentsSuggestions onChanged={() => onMemorySaved?.()} />
            <ScribeSuggestions
              key={
                [...messages]
                  .reverse()
                  .map((m) => extractScribe(m.parts)?.batchId)
                  .find(Boolean) ?? "none"
              }
              onChanged={() => onMemorySaved?.()}
            />
            {mode === "council" ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  aria-label="Edit council"
                  className="bg-muted hover:bg-muted/80 rounded-full border px-3 py-1"
                  onClick={() => onOpenSettings("council")}
                >
                  {councilChip}
                </button>
                {estimateLabel ? (
                  <span
                    className="text-muted-foreground"
                    data-testid="council-estimate"
                  >
                    {estimateLabel}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ModelPicker value={modelId} onChange={setModelId} />
              </div>
            )}
            <div
              className="flex flex-wrap items-center gap-1.5 text-xs"
              role="group"
              aria-label="Tools"
            >
              {TOOL_TOGGLE_LABELS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={toggles[key]}
                  data-testid={`tool-toggle-${key}`}
                  disabled={isStreaming}
                  onClick={() => void toggleTool(key)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 transition-colors",
                    toggles[key]
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="bg-muted/40 flex items-end gap-2 rounded-2xl border p-2 shadow-sm">
              <Textarea
                ref={textareaRef}
                aria-label="Message"
                placeholder="Ask Araitchi…"
                rows={1}
                value={input}
                disabled={isStreaming || (mode === "solo" && !modelId)}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              {isStreaming ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="shrink-0 rounded-xl"
                  aria-label="Stop generating"
                  onClick={() => stop()}
                >
                  <Square className="size-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  className="shrink-0 rounded-xl"
                  aria-label="Send message"
                  disabled={!input.trim() || (mode === "solo" && !modelId)}
                  onClick={() => void handleSend()}
                >
                  <SendHorizontal className="size-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={overBudgetOpen} onOpenChange={setOverBudgetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Over budget cap</AlertDialogTitle>
            <AlertDialogDescription>
              The estimated council cost exceeds this project&apos;s budget cap.
              Run anyway, or edit the council in Settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOverBudgetOpen(false);
                onOpenSettings("council");
              }}
            >
              Edit council
            </Button>
            <AlertDialogAction
              onClick={() => {
                setOverBudgetOpen(false);
                void handleSend(true);
              }}
            >
              Run anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ApprovalDialog
        call={pendingApproval}
        onDecision={decideApproval}
        onClose={() => setPendingApproval(null)}
      />

      <SaveToMemoryDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        initialBody={saveBody}
        initialType={saveType}
        source={saveSource}
        sourceChatId={chatId}
        sourceMessageId={saveMessageId}
        onSaved={onMemorySaved}
      />

      {/* Keep unused import quiet in some trees */}
      <span className="hidden">
        <Check className="size-3" />
      </span>
      <span className="sr-only">{activeLeafId}</span>
    </div>
  );
}
