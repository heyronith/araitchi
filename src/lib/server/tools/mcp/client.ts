import "server-only";

import { z } from "zod";

import type { McpServerConfig } from "../tools-settings";
import type { RegisteredTool, ToolResult } from "../types";

/** Minimal tool descriptor returned by an MCP server (subset of the spec). */
export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
};

/** Thin transport-agnostic client surface used by the broker wiring. */
export interface McpClientLike {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 8_000;

/** In-memory servers for tests / e2e (`registerMockMcpServer`). */
const mockServers = new Map<string, McpClientLike>();

export function registerMockMcpServer(id: string, client: McpClientLike): void {
  mockServers.set(id, client);
}

export function clearMockMcpServers(): void {
  mockServers.clear();
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Connect to a real MCP server through @modelcontextprotocol/sdk (lazy import). */
export async function connectMcpServer(
  config: McpServerConfig,
): Promise<McpClientLike> {
  const mock = mockServers.get(config.id);
  if (mock) return mock;

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const client = new Client({ name: "araitchi", version: "0.1.0" });

  if (config.transport === "stdio") {
    if (!config.command) throw new Error("MCP stdio server needs a command");
    const { StdioClientTransport } =
      await import("@modelcontextprotocol/sdk/client/stdio.js");
    await withTimeout(
      client.connect(
        new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          stderr: "ignore",
        }),
      ),
      CONNECT_TIMEOUT_MS,
      `MCP connect (${config.name})`,
    );
  } else {
    if (!config.url) throw new Error("MCP http server needs a url");
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const headers: Record<string, string> = {};
    if (config.headerName && config.headerValue) {
      headers[config.headerName] = config.headerValue;
    }
    await withTimeout(
      client.connect(
        new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers },
        }),
      ),
      CONNECT_TIMEOUT_MS,
      `MCP connect (${config.name})`,
    );
  }

  return {
    async listTools() {
      const res = await client.listTools();
      return res.tools as McpToolDescriptor[];
    },
    async callTool(name, args) {
      return client.callTool({ name, arguments: args });
    },
    async close() {
      await client.close();
    },
  };
}

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
}

function resultToText(raw: unknown): string {
  const content = (raw as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c
          ? String((c as { text: unknown }).text)
          : JSON.stringify(c),
      )
      .join("\n");
  }
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

/**
 * Turn an MCP server's tools into broker `RegisteredTool`s.
 * Tools are `write` (approval-gated) unless the server marks them
 * `readOnlyHint` AND the user flagged the server `readOnly`.
 */
export async function createMcpTools(
  config: McpServerConfig,
  client: McpClientLike,
): Promise<RegisteredTool[]> {
  const descriptors = await client.listTools();
  return descriptors.map((d) => {
    const name = `mcp_${safeId(config.name)}_${safeId(d.name)}`;
    const readOnly =
      Boolean(config.readOnly) && d.annotations?.readOnlyHint !== false;
    return {
      name,
      description: `[MCP:${config.name}] ${d.description ?? d.name}`,
      // MCP servers validate their own args; accept any object here.
      inputSchema: z.record(z.string(), z.unknown()),
      kind: readOnly ? "read" : "write",
      provider: `mcp:${safeId(config.name)}`,
      ttlSec: 0,
      handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const raw = await client.callTool(d.name, args);
          const text = resultToText(raw);
          if ((raw as { isError?: boolean })?.isError) {
            return { ok: false, error: text };
          }
          return { ok: true, data: { text }, modelText: text };
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : "MCP call failed",
          };
        }
      },
    } satisfies RegisteredTool;
  });
}
