/** Client-safe shape of `data-tool-call` UI parts (mirrors BrokerToolEvent). */
export type ToolSourceView = {
  title?: string;
  url?: string;
  doi?: string;
  arxivId?: string;
};

export type ToolCallView = {
  id: string;
  tool: string;
  provider?: string;
  kind?: "read" | "write" | "spend";
  modelId?: string;
  args?: unknown;
  status: "ok" | "error" | "needs_approval";
  cached?: boolean;
  durationMs?: number;
  sources?: ToolSourceView[];
  error?: string;
  summary?: string;
  approvalKey?: string;
};

type AnyPart = { type: string; data?: unknown; id?: string };

export function extractToolCalls(parts: readonly AnyPart[]): ToolCallView[] {
  const out = new Map<string, ToolCallView>();
  for (const p of parts) {
    if (p.type !== "data-tool-call" || !p.data || typeof p.data !== "object") {
      continue;
    }
    const d = p.data as ToolCallView;
    if (!d.tool) continue;
    const id = d.id ?? p.id ?? `${d.tool}-${out.size}`;
    out.set(id, { ...d, id });
  }
  return [...out.values()];
}

export type MergedSource = ToolSourceView & {
  key: string;
  foundBy: string[];
};

/** Dedupe sources across calls (by DOI, arXiv id, URL, then title). */
export function mergeSources(calls: ToolCallView[]): MergedSource[] {
  const map = new Map<string, MergedSource>();
  for (const call of calls) {
    for (const s of call.sources ?? []) {
      const key = (s.doi ?? s.arxivId ?? s.url ?? s.title ?? "").toLowerCase();
      if (!key) continue;
      const prev = map.get(key);
      const who = call.modelId ?? "assistant";
      if (prev) {
        if (!prev.foundBy.includes(who)) prev.foundBy.push(who);
      } else {
        map.set(key, { ...s, key, foundBy: [who] });
      }
    }
  }
  return [...map.values()];
}

export function describeToolCall(call: ToolCallView): string {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const q = typeof args.query === "string" ? args.query : undefined;
  const label =
    call.tool === "search_papers"
      ? "Searched papers"
      : call.tool === "read_document"
        ? "Read document"
        : call.tool.startsWith("repo_")
          ? `Repo: ${call.tool.slice(5)}`
          : call.tool.startsWith("mcp_")
            ? `MCP: ${call.tool}`
            : call.tool;
  return [label, q ? `'${q}'` : null, call.summary ?? null]
    .filter(Boolean)
    .join(" · ");
}
