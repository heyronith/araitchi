import "server-only";

import { tool as aiTool, type ToolSet } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getCached, hashArgs, setCached } from "./cache";
import { insertToolCall } from "./provenance";
import { DEFAULT_PROVIDER_LIMITS, RateLimiter } from "./rate-limit";
import type {
  RegisteredTool,
  ToolHandlerContext,
  ToolResult,
  ToolSource,
} from "./types";
import { truncateForModel, wrapUntrustedToolResult } from "./untrusted";

export type BrokerCallResult = ToolResult & {
  cached: boolean;
  modelPayload: string;
  fullResult: unknown;
  durationMs: number;
  needsApproval?: boolean;
};

/** Emitted once per finished broker call (any model, any outcome). */
export type BrokerToolEvent = {
  id: string;
  tool: string;
  provider: string;
  kind: "read" | "write" | "spend";
  modelId: string;
  args: unknown;
  status: "ok" | "error" | "needs_approval";
  cached: boolean;
  durationMs: number;
  sources?: ToolSource[];
  error?: string;
  /** Short human summary, e.g. "31 results". */
  summary?: string;
  /** Key to send in `approvals` to allow a gated call (needs_approval only). */
  approvalKey?: string;
};

function summarizeResult(name: string, result: BrokerCallResult): string {
  if (result.needsApproval) return "Waiting for approval";
  if (!result.ok) return result.error;
  const data = result.data as {
    papers?: unknown[];
    results?: unknown[];
  } | null;
  if (data && Array.isArray(data.papers))
    return `${data.papers.length} results`;
  if (data && Array.isArray(data.results))
    return `${data.results.length} results`;
  if (result.sources?.length) return `${result.sources.length} sources`;
  return name;
}

export type ToolBrokerOptions = {
  projectPath: string;
  chatId: string;
  messageId: string;
  timeoutMs?: number;
  modelMaxChars?: number;
};

const limiters = new Map<string, RateLimiter>();

function limiterFor(provider: string): RateLimiter {
  const existing = limiters.get(provider);
  if (existing) return existing;
  const rate =
    DEFAULT_PROVIDER_LIMITS[provider] ?? DEFAULT_PROVIDER_LIMITS.default ?? 5;
  const lim = new RateLimiter(Math.max(1, rate), rate);
  limiters.set(provider, lim);
  return lim;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`Tool timed out after ${ms}ms`)),
      ms,
    );
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function approvalKey(tool: string, argsHash: string): string {
  return `${tool}:${argsHash}`;
}

export class ToolBroker {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly inflight = new Map<string, Promise<BrokerCallResult>>();
  private readonly approvals = new Map<string, boolean>();
  private readonly listeners = new Set<(event: BrokerToolEvent) => void>();
  private readonly timeoutMs: number;
  private readonly modelMaxChars: number;

  constructor(private readonly opts: ToolBrokerOptions) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.modelMaxChars = opts.modelMaxChars ?? 12_000;
  }

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: RegisteredTool[]): void {
    for (const t of tools) this.register(t);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  setApproval(toolCallKey: string, approved: boolean): void {
    this.approvals.set(toolCallKey, approved);
  }

  approve(tool: string, args: unknown, approved: boolean): string {
    const key = approvalKey(tool, hashArgs(args));
    this.approvals.set(key, approved);
    return key;
  }

  /** Subscribe to completed tool calls (UI streaming / persistence). */
  onToolEvent(listener: (event: BrokerToolEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async call(
    name: string,
    args: unknown,
    ctx: { modelId: string; signal?: AbortSignal },
  ): Promise<BrokerCallResult> {
    const result = await this.callInner(name, args, ctx);
    const registered = this.tools.get(name);
    const event: BrokerToolEvent = {
      id: nanoid(),
      tool: name,
      provider: registered?.provider ?? "broker",
      kind: registered?.kind ?? "read",
      modelId: ctx.modelId,
      args,
      status: result.needsApproval
        ? "needs_approval"
        : result.ok
          ? "ok"
          : "error",
      cached: result.cached,
      durationMs: result.durationMs,
      sources: result.ok ? result.sources : undefined,
      error: result.ok ? undefined : result.error,
      summary: summarizeResult(name, result),
      approvalKey: result.needsApproval
        ? this.approvalKeyFor(name, args)
        : undefined,
    };
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* listener errors must not break the model loop */
      }
    }
    return result;
  }

  private approvalKeyFor(name: string, args: unknown): string | undefined {
    const registered = this.tools.get(name);
    const parsed = registered?.inputSchema.safeParse(args);
    if (!parsed?.success) return undefined;
    return approvalKey(name, hashArgs(parsed.data));
  }

  private async callInner(
    name: string,
    args: unknown,
    ctx: { modelId: string; signal?: AbortSignal },
  ): Promise<BrokerCallResult> {
    const started = Date.now();
    const registered = this.tools.get(name);
    if (!registered) {
      return this.fail(
        name,
        args,
        ctx.modelId,
        started,
        false,
        `Unknown tool: ${name}`,
      );
    }

    const parsed = registered.inputSchema.safeParse(args);
    if (!parsed.success) {
      return this.fail(
        name,
        args,
        ctx.modelId,
        started,
        false,
        `Invalid args: ${parsed.error.message}`,
      );
    }

    const argsHash = hashArgs(parsed.data);
    const key = approvalKey(name, argsHash);

    if (registered.kind !== "read") {
      const approved = this.approvals.get(key);
      if (approved !== true) {
        insertToolCall({
          projectPath: this.opts.projectPath,
          chatId: this.opts.chatId,
          messageId: this.opts.messageId,
          modelId: ctx.modelId,
          tool: name,
          args: parsed.data,
          status: "needs_approval",
          cached: false,
          durationMs: Date.now() - started,
        });
        const err = "Approval required";
        return {
          ok: false,
          error: err,
          cached: false,
          needsApproval: true,
          modelPayload: wrapUntrustedToolResult(
            name,
            registered.provider,
            truncateForModel(JSON.stringify({ ok: false, error: err })),
          ),
          fullResult: { ok: false, error: err, needsApproval: true },
          durationMs: Date.now() - started,
        };
      }
    }

    const inflightKey = `${name}:${argsHash}`;
    const existing = this.inflight.get(inflightKey);
    if (existing) return existing;

    const run = this.execute(registered, parsed.data, argsHash, ctx);
    this.inflight.set(inflightKey, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(inflightKey);
    }
  }

  private async execute(
    registered: RegisteredTool,
    args: unknown,
    argsHash: string,
    ctx: { modelId: string; signal?: AbortSignal },
  ): Promise<BrokerCallResult> {
    const started = Date.now();
    const name = registered.name;

    if (registered.ttlSec > 0) {
      const hit = getCached(
        this.opts.projectPath,
        name,
        argsHash,
        registered.ttlSec,
      );
      if (hit != null) {
        let data: unknown = hit;
        try {
          data = JSON.parse(hit) as unknown;
        } catch {
          /* keep string */
        }
        const sources = extractSources(data);
        const modelPayload = wrapUntrustedToolResult(
          name,
          registered.provider,
          truncateForModel(
            typeof data === "string" ? data : JSON.stringify(data, null, 0),
            this.modelMaxChars,
          ),
        );
        insertToolCall({
          projectPath: this.opts.projectPath,
          chatId: this.opts.chatId,
          messageId: this.opts.messageId,
          modelId: ctx.modelId,
          tool: name,
          args,
          status: "ok",
          cached: true,
          durationMs: Date.now() - started,
          sources,
        });
        return {
          ok: true,
          data,
          sources,
          cached: true,
          modelPayload,
          fullResult: data,
          durationMs: Date.now() - started,
        };
      }
    }

    try {
      await limiterFor(registered.provider).waitTake(ctx.signal);
    } catch (e) {
      return this.fail(
        name,
        args,
        ctx.modelId,
        started,
        false,
        e instanceof Error ? e.message : "Rate limited",
      );
    }

    const handlerCtx: ToolHandlerContext = {
      projectPath: this.opts.projectPath,
      chatId: this.opts.chatId,
      messageId: this.opts.messageId,
      modelId: ctx.modelId,
      signal: ctx.signal,
    };

    let result: ToolResult;
    try {
      result = await withTimeout(
        registered.handler(args as never, handlerCtx),
        this.timeoutMs,
        ctx.signal,
      );
    } catch (e) {
      return this.fail(
        name,
        args,
        ctx.modelId,
        started,
        false,
        e instanceof Error ? e.message : "Tool failed",
      );
    }

    const durationMs = Date.now() - started;
    if (!result.ok) {
      insertToolCall({
        projectPath: this.opts.projectPath,
        chatId: this.opts.chatId,
        messageId: this.opts.messageId,
        modelId: ctx.modelId,
        tool: name,
        args,
        status: "error",
        cached: false,
        durationMs,
      });
      return {
        ...result,
        cached: false,
        modelPayload: wrapUntrustedToolResult(
          name,
          registered.provider,
          truncateForModel(JSON.stringify(result), this.modelMaxChars),
        ),
        fullResult: result,
        durationMs,
      };
    }

    const payloadBody =
      result.modelText ??
      JSON.stringify(
        { ok: true, data: result.data, sources: result.sources ?? [] },
        null,
        0,
      );
    if (registered.ttlSec > 0) {
      setCached(
        this.opts.projectPath,
        name,
        argsHash,
        JSON.stringify(result.data),
      );
    }
    const modelPayload = wrapUntrustedToolResult(
      name,
      registered.provider,
      truncateForModel(payloadBody, this.modelMaxChars),
    );
    insertToolCall({
      projectPath: this.opts.projectPath,
      chatId: this.opts.chatId,
      messageId: this.opts.messageId,
      modelId: ctx.modelId,
      tool: name,
      args,
      status: "ok",
      cached: false,
      durationMs,
      sources: result.sources,
    });
    return {
      ...result,
      cached: false,
      modelPayload,
      fullResult: result.data,
      durationMs,
    };
  }

  private fail(
    name: string,
    args: unknown,
    modelId: string,
    started: number,
    cached: boolean,
    error: string,
  ): BrokerCallResult {
    const durationMs = Date.now() - started;
    insertToolCall({
      projectPath: this.opts.projectPath,
      chatId: this.opts.chatId,
      messageId: this.opts.messageId,
      modelId,
      tool: name,
      args,
      status: "error",
      cached,
      durationMs,
    });
    return {
      ok: false,
      error,
      cached,
      modelPayload: wrapUntrustedToolResult(
        name,
        "broker",
        truncateForModel(JSON.stringify({ ok: false, error })),
      ),
      fullResult: { ok: false, error },
      durationMs,
    };
  }

  /** AI SDK tool map for streamText / generateText. */
  getAiSdkTools(input: {
    modelId: string;
    signal?: AbortSignal;
    filter?: (t: RegisteredTool) => boolean;
    /** Also expose write/spend tools; their calls are approval-gated in `call`. */
    includeNonRead?: boolean;
  }): ToolSet {
    const out: ToolSet = {};
    for (const registered of this.tools.values()) {
      if (input.filter && !input.filter(registered)) continue;
      // Write/spend tools are only exposed when asked; `call` still gates them.
      if (registered.kind !== "read" && !input.includeNonRead) continue;
      const name = registered.name;
      out[name] = aiTool({
        description: registered.description,
        inputSchema: registered.inputSchema as z.ZodType,
        execute: async (toolArgs) => {
          const result = await this.call(name, toolArgs, {
            modelId: input.modelId,
            signal: input.signal,
          });
          return result.modelPayload;
        },
      });
    }
    return out;
  }
}

function extractSources(data: unknown): ToolSource[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (
    "sources" in data &&
    Array.isArray((data as { sources: unknown }).sources)
  ) {
    return (data as { sources: ToolSource[] }).sources;
  }
  if ("papers" in data && Array.isArray((data as { papers: unknown }).papers)) {
    return (data as { papers: ToolSource[] }).papers.map((p) => ({
      title: typeof p.title === "string" ? p.title : undefined,
      url: typeof p.url === "string" ? p.url : undefined,
      doi: typeof p.doi === "string" ? p.doi : undefined,
      arxivId: typeof p.arxivId === "string" ? p.arxivId : undefined,
    }));
  }
  return undefined;
}

export function createBrokerForRequest(opts: ToolBrokerOptions): ToolBroker {
  return new ToolBroker(opts);
}

/** Reset process-wide rate limiters (tests). */
export function resetToolRateLimitersForTests(): void {
  limiters.clear();
}
