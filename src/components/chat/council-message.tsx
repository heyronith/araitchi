"use client";

import { BookmarkPlus, ChevronDown, Copy } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/chat/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "cn";

export type CouncilMemberView = {
  modelId: string;
  lab?: string;
  content: string;
  status: string;
  cost?: number | null;
  latencyMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number } | null;
  substitutedFrom?: string | null;
  error?: string | null;
  streamingText?: string;
};

export type CouncilAnalysisView = {
  finalAnswer?: string;
  consensus: string[];
  contradictions: {
    topic: string;
    positions: { member: string; stance: string }[];
    needsEvidence: boolean;
  }[];
  uniqueInsights: { member: string; insight: string }[];
  blindSpots: string[];
  confidence: "low" | "medium" | "high";
};

export type CouncilSummaryView = {
  membersOk: number;
  membersFailed: number;
  totalCost: number;
  totalTimeMs: number;
  confidence?: "low" | "medium" | "high";
};

type CouncilMessageProps = {
  finalAnswer: string;
  members: CouncilMemberView[];
  analysis: CouncilAnalysisView | null;
  summary: CouncilSummaryView | null;
  onSaveToMemory: (body: string, preferredType?: string) => void;
  /** When true and there is no final answer yet, omit the empty answer shell. */
  streaming?: boolean;
  statusSlot?: React.ReactNode;
};

function labOf(modelId: string, lab?: string) {
  return lab || modelId.split("/")[0] || "unknown";
}

export function CouncilMessage({
  finalAnswer,
  members,
  analysis,
  summary,
  onSaveToMemory,
  streaming = false,
  statusSlot,
}: CouncilMessageProps) {
  const hasContradictions = (analysis?.contradictions.length ?? 0) > 0;
  const [disagreementOpen, setDisagreementOpen] =
    React.useState(hasContradictions);

  const memberCount = members.length || summary?.membersOk || 0;
  const cost = summary?.totalCost;
  const secs =
    summary?.totalTimeMs != null
      ? Math.round(summary.totalTimeMs / 1000)
      : null;
  const confidence = analysis?.confidence ?? summary?.confidence;
  const showFinal = Boolean(finalAnswer.trim()) || (!streaming && !statusSlot);

  return (
    <div
      className="flex w-full flex-col gap-3"
      data-variant="open"
      data-testid="council-message"
    >
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span className="bg-muted text-foreground inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold">
          C
        </span>
        <span className="text-foreground font-medium">Council</span>
        <span>·</span>
        <span>{memberCount} members</span>
        {typeof cost === "number" ? (
          <>
            <span>·</span>
            <span>${cost.toFixed(4)}</span>
          </>
        ) : null}
        {secs != null ? (
          <>
            <span>·</span>
            <span>{secs} s</span>
          </>
        ) : null}
        {confidence ? (
          <>
            <span>·</span>
            <span>confidence: {confidence}</span>
          </>
        ) : null}
      </div>

      {statusSlot}

      {showFinal ? (
        <div className="w-full" data-testid="council-final-answer">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Final answer
            </p>
            <div className="flex gap-1">
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Copy final answer"
                onClick={async () => {
                  await navigator.clipboard.writeText(finalAnswer);
                  toast.success("Copied");
                }}
              >
                <Copy className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Save final answer to memory"
                onClick={() => onSaveToMemory(finalAnswer, "note")}
              >
                <BookmarkPlus className="size-3.5" />
              </Button>
            </div>
          </div>
          {finalAnswer.trim() ? <Markdown content={finalAnswer} /> : null}
        </div>
      ) : null}

      {analysis ? (
        <Collapsible open={disagreementOpen} onOpenChange={setDisagreementOpen}>
          <CollapsibleTrigger className="hover:bg-muted/40 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm">
            <span className="font-medium">Disagreement analysis</span>
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                disagreementOpen && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-4 rounded-lg border p-3 text-sm">
            <section>
              <h4 className="mb-1 text-xs font-semibold tracking-wide uppercase">
                Agreed
              </h4>
              {analysis.consensus.length === 0 ? (
                <p className="text-muted-foreground text-xs">None noted.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-4">
                  {analysis.consensus.map((c) => (
                    <li key={c}>
                      <div className="flex items-start justify-between gap-2">
                        <span>{c}</span>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Save consensus to memory"
                          onClick={() => onSaveToMemory(c, "decision")}
                        >
                          <BookmarkPlus className="size-3" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1 text-xs font-semibold tracking-wide uppercase">
                Disagreed
              </h4>
              {analysis.contradictions.length === 0 ? (
                <p className="text-muted-foreground text-xs">None noted.</p>
              ) : (
                <ul className="space-y-3">
                  {analysis.contradictions.map((c) => (
                    <li key={c.topic} className="rounded-md border p-2">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-medium">{c.topic}</span>
                        {c.needsEvidence ? (
                          <Badge variant="secondary" className="text-[10px]">
                            needs evidence
                          </Badge>
                        ) : null}
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          className="ml-auto"
                          aria-label="Save contradiction to memory"
                          onClick={() =>
                            onSaveToMemory(
                              `Contradiction: ${c.topic}\n\n${c.positions
                                .map((p) => `- ${p.member}: ${p.stance}`)
                                .join("\n")}`,
                              "question",
                            )
                          }
                        >
                          <BookmarkPlus className="size-3" />
                        </Button>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {c.positions.map((p) => (
                          <li key={`${c.topic}-${p.member}`}>
                            <Badge
                              variant="outline"
                              className="mr-1 text-[10px]"
                            >
                              {labOf(p.member)}
                            </Badge>
                            <span className="font-medium">{p.member}</span>:{" "}
                            {p.stance}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1 text-xs font-semibold tracking-wide uppercase">
                Only one model raised
              </h4>
              {analysis.uniqueInsights.length === 0 ? (
                <p className="text-muted-foreground text-xs">None noted.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-4">
                  {analysis.uniqueInsights.map((u) => (
                    <li key={`${u.member}-${u.insight}`}>
                      <span className="font-medium">{u.member}</span>:{" "}
                      {u.insight}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1 text-xs font-semibold tracking-wide uppercase">
                Blind spots
              </h4>
              {analysis.blindSpots.length === 0 ? (
                <p className="text-muted-foreground text-xs">None noted.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-4">
                  {analysis.blindSpots.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <div className="hidden gap-2 md:grid md:grid-cols-3">
        {members.map((m) => (
          <MemberCard key={m.modelId} member={m} />
        ))}
      </div>

      <div className="md:hidden">
        <Tabs defaultValue={members[0]?.modelId}>
          <TabsList className="mb-2 flex h-auto flex-wrap">
            {members.map((m) => (
              <TabsTrigger
                key={m.modelId}
                value={m.modelId}
                className="text-xs"
              >
                {m.modelId.split("/")[1] ?? m.modelId}
              </TabsTrigger>
            ))}
          </TabsList>
          {members.map((m) => (
            <TabsContent key={m.modelId} value={m.modelId}>
              <MemberCard member={m} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

function MemberCard({ member }: { member: CouncilMemberView }) {
  const [open, setOpen] = React.useState(true);
  const body = member.streamingText || member.content || member.error || "";
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border"
    >
      <CollapsibleTrigger className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{member.modelId}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px]">
              {labOf(member.modelId, member.lab)}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {member.status}
            </Badge>
            {member.substitutedFrom ? (
              <Badge variant="secondary" className="text-[10px]">
                substituted
              </Badge>
            ) : null}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        <Markdown content={body || "_Waiting…_"} />
        <p className="text-muted-foreground mt-2 text-[10px]">
          {[
            member.usage?.inputTokens != null ||
            member.usage?.outputTokens != null
              ? `${member.usage?.inputTokens ?? 0}→${member.usage?.outputTokens ?? 0} tok`
              : null,
            typeof member.cost === "number"
              ? `$${member.cost.toFixed(4)}`
              : null,
            member.latencyMs != null ? `${member.latencyMs} ms` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
