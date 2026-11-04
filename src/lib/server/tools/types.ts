import type { ZodType } from "zod";

export type ToolKind = "read" | "write" | "spend";

export type ToolSource = {
  title?: string;
  url?: string;
  doi?: string;
  arxivId?: string;
};

export type ToolResult =
  | {
      ok: true;
      data: unknown;
      sources?: ToolSource[];
      modelText?: string;
    }
  | {
      ok: false;
      error: string;
      /** Optional structured detail (e.g. provider attempts on a miss). */
      data?: unknown;
    };

export type ToolHandlerContext = {
  projectPath: string;
  chatId: string;
  messageId: string;
  modelId: string;
  signal?: AbortSignal;
};

export type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: ZodType;
  kind: ToolKind;
  provider: string;
  /** Cache TTL in seconds. 0 disables caching. */
  ttlSec: number;
  handler: (args: any, ctx: ToolHandlerContext) => Promise<ToolResult>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type ToolToggles = {
  papers: boolean;
  web: boolean;
  documents: boolean;
  repo: boolean;
  mcp: boolean;
  memory: boolean;
};
