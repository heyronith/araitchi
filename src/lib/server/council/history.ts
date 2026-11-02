import type { UIMessage } from "ai";

/**
 * Earlier council turns in chat history are passed to models as the
 * synthesizer **final answer only** — never raw member answers, analysis
 * parts, or per-member streaming data. That keeps context small and stops
 * later members from seeing prior members' private replies.
 */
export function sanitizeCouncilHistoryForModel(
  messages: UIMessage[],
): UIMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    const parts = m.parts ?? [];
    const isCouncil = parts.some(
      (p) =>
        typeof p.type === "string" &&
        (p.type === "data-council-summary" ||
          p.type === "data-member" ||
          p.type === "data-analysis"),
    );
    if (!isCouncil) return m;

    const text = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();

    const analysisPart = parts.find((p) => p.type === "data-analysis") as
      { type: "data-analysis"; data?: { finalAnswer?: string } } | undefined;
    const finalAnswer =
      text ||
      (typeof analysisPart?.data?.finalAnswer === "string"
        ? analysisPart.data.finalAnswer
        : "");

    return {
      ...m,
      parts: [{ type: "text", text: finalAnswer || "(empty council answer)" }],
    };
  });
}
