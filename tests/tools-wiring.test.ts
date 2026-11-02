import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { chatRequestSchema } from "@/lib/chat/validation";
import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";
import {
  createBrokerForRequest,
  resetToolRateLimitersForTests,
} from "@/lib/server/tools/broker";
import {
  clearMockMcpServers,
  createMcpTools,
  registerMockMcpServer,
} from "@/lib/server/tools/mcp/client";
import { buildBrokerTools } from "@/lib/server/tools/register";
import {
  DEFAULT_MAX_STEPS,
  getContactEmail,
  getMaxSteps,
  getToolToggles,
  setContactEmail,
  setMaxSteps,
  setToolToggles,
  type McpServerConfig,
} from "@/lib/server/tools/tools-settings";

afterEach(() => {
  closeAllNotebookDbs();
  resetToolRateLimitersForTests();
  clearMockMcpServers();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-wiring-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "wiring-test" });
  writeFileSync(path.join(dir, "README.md"), "x");
  return dir;
}

describe("tool settings", () => {
  it("defaults: papers/web on, others off, maxSteps 8", () => {
    const p = tempProject();
    expect(getToolToggles(p)).toEqual({
      papers: true,
      web: true,
      documents: false,
      repo: false,
      mcp: false,
      memory: true,
    });
    expect(getMaxSteps(p)).toBe(DEFAULT_MAX_STEPS);
  });

  it("persists toggles, maxSteps and contact email", () => {
    const p = tempProject();
    setToolToggles(p, { papers: false, repo: true });
    setMaxSteps(p, 3);
    setContactEmail(" me@example.com ");
    expect(getToolToggles(p)).toMatchObject({ papers: false, repo: true });
    expect(getMaxSteps(p)).toBe(3);
    expect(getContactEmail()).toBe("me@example.com");
  });
});

describe("chat request schema", () => {
  it("accepts tools and toolApprovals", () => {
    const r = chatRequestSchema.safeParse({
      chatId: "c1",
      modelId: "openai/gpt-4o-mini",
      tools: { papers: true, mcp: false },
      toolApprovals: { "t:abc": true },
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("buildBrokerTools", () => {
  it("registers only enabled tools", async () => {
    const p = tempProject();
    const broker = createBrokerForRequest({
      projectPath: p,
      chatId: "c",
      messageId: "m",
    });
    const built = await buildBrokerTools({
      broker,
      projectPath: p,
      toggles: {
        papers: false,
        web: false,
        documents: true,
        repo: false,
        mcp: false,
        memory: false,
      },
    });
    expect(built.registered).toContain("read_document");
    expect(built.registered.some((n) => n.startsWith("repo_"))).toBe(false);
    await built.close();
  });

  it("MCP write tools are blocked until approved and emit tool events", async () => {
    const p = tempProject();
    const calls: string[] = [];
    const server: McpServerConfig = {
      id: "mock1",
      name: "mock",
      transport: "stdio",
      command: "ignored",
      enabled: true,
    };
    registerMockMcpServer("mock1", {
      listTools: async () => [{ name: "delete_all", description: "danger" }],
      callTool: async (name) => {
        calls.push(name);
        return { content: [{ type: "text", text: "done" }] };
      },
      close: async () => undefined,
    });
    const broker = createBrokerForRequest({
      projectPath: p,
      chatId: "c",
      messageId: "m",
    });
    const events: { status: string; approvalKey?: string }[] = [];
    broker.onToolEvent((e) => events.push(e));

    const built = await buildBrokerTools({
      broker,
      projectPath: p,
      toggles: {
        papers: false,
        web: false,
        documents: false,
        repo: false,
        mcp: true,
        memory: false,
      },
      mcpServers: [server],
    });
    expect(built.registered).toEqual(["mcp_mock_delete_all"]);

    // Not exposed to the model by default, exposed when asked.
    expect(Object.keys(broker.getAiSdkTools({ modelId: "m/x" }))).toEqual([]);
    expect(
      Object.keys(
        broker.getAiSdkTools({ modelId: "m/x", includeNonRead: true }),
      ),
    ).toEqual(["mcp_mock_delete_all"]);

    const denied = await broker.call(
      "mcp_mock_delete_all",
      { a: 1 },
      { modelId: "m/x" },
    );
    expect(denied.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(events[0]?.status).toBe("needs_approval");
    expect(events[0]?.approvalKey).toBeTruthy();

    broker.setApproval(events[0]!.approvalKey!, true);
    const allowed = await broker.call(
      "mcp_mock_delete_all",
      { a: 1 },
      { modelId: "m/x" },
    );
    expect(allowed.ok).toBe(true);
    expect(calls).toEqual(["delete_all"]);
    await built.close();
  });

  it("readOnly MCP servers expose read tools", async () => {
    const tools = await createMcpTools(
      {
        id: "r",
        name: "ro",
        transport: "http",
        url: "http://x",
        enabled: true,
        readOnly: true,
      },
      {
        listTools: async () => [{ name: "lookup" }],
        callTool: async () => ({ content: [] }),
        close: async () => undefined,
      },
    );
    expect(tools[0]?.kind).toBe("read");
  });
});
