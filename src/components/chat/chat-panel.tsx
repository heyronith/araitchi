"use client";

import { useChat } from "@ai-sdk/react";
import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { UIMessage } from "ai";
import {
  ArrowDown,
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

import { Markdown } from "@/components/chat/markdown";
import { ModelPicker } from "@/components/chat/model-picker";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { getBranchMeta, type StoredMessage } from "@/lib/chat/branches";
import { cn } from "cn";

type ChatPanelProps = {
  chatId: string;
  hasKey: boolean;
  onOpenSettings: () => void;
  onChatUpdated?: () => void;
};

type MessageMeta = {
  modelId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
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

export function ChatPanel({
  chatId,
  hasKey,
  onOpenSettings,
  onChatUpdated,
}: ChatPanelProps) {
  const [modelId, setModelId] = React.useState<string | null>(null);
  const [input, setInput] = React.useState("");
  const [allStored, setAllStored] = React.useState<StoredMessage[]>([]);
  const [activeLeafId, setActiveLeafId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  const [showScrollBtn, setShowScrollBtn] = React.useState(false);
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
            ...body,
            id,
            messages,
            trigger,
            messageId,
            chatId,
            modelId,
          },
        }),
      }),
    [chatId, modelId],
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
        const res = await fetch(`/api/chats/${chatId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages: StoredMessage[];
          activeBranch: StoredMessage[];
        };
        setAllStored(data.messages);
        setMessages(storedToUi(data.activeBranch));
        setActiveLeafId(data.activeBranch.at(-1)?.id ?? null);
      })();
    },
    onError: (err) => {
      toast.error(err.message || "Chat request failed");
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";

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
    if (isStreaming) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isStreaming]);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, [chatId, hasKey]);

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

  async function handleSend() {
    const text = input.trim();
    if (!text || !modelId || isStreaming || !hasKey) return;
    setInput("");
    await sendMessage({ text });
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

          {messages.map((message) => {
            const text = extractText(message);
            const reasoning = extractReasoning(message);
            const meta = (message.metadata ?? {}) as MessageMeta;
            const branch = getBranchMeta(allStored, message.id);

            return (
              <div
                key={message.id}
                className={cn(
                  "group flex flex-col gap-2",
                  message.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[95%] rounded-2xl px-4 py-3 sm:max-w-[85%]",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 border",
                  )}
                >
                  {editingId === message.id ? (
                    <div className="space-y-2">
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
                    <>
                      {reasoning ? (
                        <Collapsible className="mb-3">
                          <CollapsibleTrigger className="text-muted-foreground text-xs underline-offset-2 hover:underline">
                            Reasoning
                          </CollapsibleTrigger>
                          <CollapsibleContent className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">
                            {reasoning}
                          </CollapsibleContent>
                        </Collapsible>
                      ) : null}
                      <Markdown content={text || (isStreaming ? "…" : "")} />
                    </>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{text}</p>
                  )}
                </div>

                <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
                          await navigator.clipboard.writeText(text);
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
                </div>

                {message.role === "assistant" && !isStreaming ? (
                  <div className="text-muted-foreground px-1 text-[11px]">
                    {[
                      meta.modelId,
                      meta.usage?.inputTokens != null ||
                      meta.usage?.outputTokens != null
                        ? `${meta.usage?.inputTokens ?? 0}→${meta.usage?.outputTokens ?? 0} tok`
                        : null,
                      typeof meta.usage?.cost === "number"
                        ? `$${meta.usage.cost.toFixed(4)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
              </div>
            );
          })}

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
            <Button type="button" onClick={onOpenSettings}>
              Connect OpenRouter to start
            </Button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-2">
            <div className="flex items-center gap-2">
              <ModelPicker value={modelId} onChange={setModelId} />
            </div>
            <div className="bg-muted/40 flex items-end gap-2 rounded-2xl border p-2 shadow-sm">
              <Textarea
                ref={textareaRef}
                aria-label="Message"
                placeholder="Ask Araitchi…"
                rows={1}
                value={input}
                disabled={isStreaming || !modelId}
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
                  disabled={!input.trim() || !modelId}
                  onClick={() => void handleSend()}
                >
                  <SendHorizontal className="size-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Keep unused import quiet in some trees */}
      <span className="hidden">
        <Check className="size-3" />
      </span>
      <span className="sr-only">{activeLeafId}</span>
    </div>
  );
}
