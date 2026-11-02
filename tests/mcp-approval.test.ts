import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";
import {
  resetToolRateLimitersForTests,
  ToolBroker,
} from "@/lib/server/tools/broker";
import {
  clearMockMcpServers,
  connectMcpServer,
  createMcpTools,
  registerMockMcpServer,
  type McpClientLike,
} from "@/lib/server/tools/mcp/client";
import type { McpServerConfig } from "@/lib/server/tools/tools-settings";

afterEach(() => {
  clearMockMcpServers();
  closeAllNotebookDbs();
  resetToolRateLimitersForTests();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-mcp-"));
  ensureResearchStructure(dir, { name: "mcp-test" });
  return dir;
}

describe("MCP write tool approval", () => {
  it("blocks without approval, then runs after approve", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client: McpClientLike = {
      listTools: async () => [
        {
          name: "write_file",
          description: "Write a file",
          inputSchema: { type: "object" },
        },
      ],
      callTool: async (name, args) => {
        calls.push({ name, args });
        return { content: [{ type: "text", text: "written" }] };
      },
      close: async () => undefined,
    };

    const config: McpServerConfig = {
      id: "mock-1",
      name: "mock",
      transport: "stdio",
      command: "unused",
      enabled: true,
    };
    registerMockMcpServer(config.id, client);

    const connected = await connectMcpServer(config);
    const tools = await createMcpTools(config, connected);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.kind).toBe("write");

    const broker = new ToolBroker({
      projectPath: tempProject(),
      chatId: "c1",
      messageId: "m1",
    });
    broker.registerAll(tools);
    const name = tools[0]!.name;
    const args = { path: "a.txt", content: "hi" };

    const blocked = await broker.call(name, args, { modelId: "m" });
    expect(blocked.ok).toBe(false);
    expect(blocked.needsApproval).toBe(true);
    expect(calls).toHaveLength(0);

    broker.approve(name, args, true);
    const ok = await broker.call(name, args, { modelId: "m" });
    expect(ok.ok).toBe(true);
    expect(calls).toEqual([{ name: "write_file", args }]);
    expect(ok.modelPayload).toContain("written");
  });
});
