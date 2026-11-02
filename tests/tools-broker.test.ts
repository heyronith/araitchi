import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { closeAllNotebookDbs } from "@/lib/server/project/db";
import { ensureResearchStructure } from "@/lib/server/project/init";
import {
  createBrokerForRequest,
  resetToolRateLimitersForTests,
  ToolBroker,
} from "@/lib/server/tools/broker";
import { RateLimiter } from "@/lib/server/tools/rate-limit";
import type { RegisteredTool } from "@/lib/server/tools/types";
import {
  truncateForModel,
  wrapUntrustedToolResult,
} from "@/lib/server/tools/untrusted";

afterEach(() => {
  closeAllNotebookDbs();
  resetToolRateLimitersForTests();
});

function tempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "araitchi-broker-"));
  mkdirSync(dir, { recursive: true });
  ensureResearchStructure(dir, { name: "broker-test" });
  writeFileSync(path.join(dir, "README.md"), "x");
  return dir;
}

describe("untrusted wrapper + truncate", () => {
  it("wraps with untrusted marker", () => {
    const w = wrapUntrustedToolResult("search_papers", "openalex", "hello");
    expect(w).toContain('untrusted="true"');
    expect(w).toContain('tool="search_papers"');
    expect(w).toContain("hello");
  });

  it("truncates with marker", () => {
    const t = truncateForModel("a".repeat(100), 50);
    expect(t.endsWith("[truncated]")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(50 + "\n[truncated]".length);
  });
});

describe("rate limiter", () => {
  it("tryTake respects capacity", () => {
    const lim = new RateLimiter(2, 100);
    expect(lim.tryTake()).toBe(true);
    expect(lim.tryTake()).toBe(true);
    expect(lim.tryTake()).toBe(false);
  });
});

describe("broker", () => {
  it("caches successful reads and dedupes in-flight calls", async () => {
    const projectPath = tempProject();
    const broker = createBrokerForRequest({
      projectPath,
      chatId: "c1",
      messageId: "m1",
    });
    let runs = 0;
    const slow: RegisteredTool = {
      name: "echo",
      description: "echo",
      inputSchema: z.object({ q: z.string() }),
      kind: "read",
      provider: "default",
      ttlSec: 3600,
      handler: async (args) => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 50));
        return { ok: true, data: { q: (args as { q: string }).q } };
      },
    };
    broker.register(slow);

    const [a, b] = await Promise.all([
      broker.call("echo", { q: "same" }, { modelId: "m" }),
      broker.call("echo", { q: "same" }, { modelId: "m" }),
    ]);
    expect(runs).toBe(1);
    expect(a.ok && b.ok).toBe(true);

    const cached = await broker.call("echo", { q: "same" }, { modelId: "m" });
    expect(cached.cached).toBe(true);
    expect(runs).toBe(1);
    expect(cached.modelPayload).toContain("untrusted");
  });

  it("blocks write tools until approved", async () => {
    const projectPath = tempProject();
    const broker = new ToolBroker({
      projectPath,
      chatId: "c1",
      messageId: "m1",
    });
    const writeTool: RegisteredTool = {
      name: "mcp_write",
      description: "write",
      inputSchema: z.object({ x: z.string() }),
      kind: "write",
      provider: "mcp",
      ttlSec: 0,
      handler: async () => ({ ok: true, data: { wrote: true } }),
    };
    broker.register(writeTool);

    const denied = await broker.call("mcp_write", { x: "1" }, { modelId: "m" });
    expect(denied.ok).toBe(false);
    expect(denied.needsApproval).toBe(true);

    broker.approve("mcp_write", { x: "1" }, true);
    const ok = await broker.call("mcp_write", { x: "1" }, { modelId: "m" });
    expect(ok.ok).toBe(true);
  });
});

// silence unused vi in case
void vi;
