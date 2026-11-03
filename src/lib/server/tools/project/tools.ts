import "server-only";

import { z } from "zod";

import { searchActivity } from "@/lib/server/continuity/activity";
import {
  indexProject,
  projectTree,
  searchProjectFiles,
} from "@/lib/server/continuity/indexer";
import {
  readProjectFilePage,
  recordRead,
} from "@/lib/server/continuity/read-file";

import type { RegisteredTool } from "../types";

export function createProjectTools(): RegisteredTool[] {
  const project_tree: RegisteredTool = {
    name: "project_tree",
    description:
      "Compact tree of files and folders under the project root (respects ignore rules).",
    inputSchema: z.object({
      path: z.string().max(500).optional(),
      depth: z.number().int().min(0).max(4).optional(),
    }),
    kind: "read",
    provider: "project",
    ttlSec: 30,
    handler: async (args, ctx) => {
      const tree = projectTree({
        projectPath: ctx.projectPath,
        path: args.path,
        depth: args.depth,
      });
      return {
        ok: true,
        data: tree,
        modelText: JSON.stringify(tree, null, 2),
      };
    },
  };

  const search_project: RegisteredTool = {
    name: "search_project",
    description:
      "Hybrid keyword + semantic search over indexed project files; returns paths and line ranges.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      kind: z.enum(["code", "docs", "data", "all"]).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    kind: "read",
    provider: "project",
    ttlSec: 0,
    handler: async (args, ctx) => {
      await indexProject(ctx.projectPath, { embed: true });
      const { hits, vectorUsed } = await searchProjectFiles({
        projectPath: ctx.projectPath,
        query: args.query,
        kind: args.kind ?? "all",
        limit: args.limit ?? 10,
      });
      return {
        ok: true,
        data: { vectorUsed, results: hits },
        modelText:
          hits
            .map(
              (h, i) =>
                `[${i + 1}] ${h.path}:${h.startLine}-${h.endLine} (${h.kind}) score=${h.score.toFixed(3)}\n${h.text.slice(0, 500)}`,
            )
            .join("\n\n") || "No matches.",
      };
    },
  };

  const read_file: RegisteredTool = {
    name: "read_file",
    description:
      "Read a page of a project file (400 lines per page) with line numbers. Confined to the project root.",
    inputSchema: z.object({
      path: z.string().min(1).max(500),
      page: z.number().int().min(1).optional(),
    }),
    kind: "read",
    provider: "project",
    ttlSec: 0,
    handler: async (args, ctx) => {
      const result = readProjectFilePage({
        projectPath: ctx.projectPath,
        path: args.path,
        page: args.page,
      });
      if ("error" in result) {
        return { ok: false, error: result.error };
      }
      recordRead({
        projectPath: ctx.projectPath,
        chatId: ctx.chatId,
        messageId: ctx.messageId,
        modelId: ctx.modelId,
        path: result.path,
        page: result.page,
        totalPages: result.totalPages,
        sha256: result.sha256,
      });
      return {
        ok: true,
        data: {
          path: result.path,
          page: result.page,
          totalPages: result.totalPages,
          totalLines: result.totalLines,
          sha256: result.sha256,
        },
        modelText: result.content,
      };
    },
  };

  const search_activity: RegisteredTool = {
    name: "search_activity",
    description:
      "Search the project activity log (tool calls, indexing, verdicts, etc.).",
    inputSchema: z.object({
      query: z.string().max(500).optional(),
      since: z.number().int().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    kind: "read",
    provider: "project",
    ttlSec: 0,
    handler: async (args, ctx) => {
      const rows = searchActivity(ctx.projectPath, args.query ?? "", {
        since: args.since,
        limit: args.limit,
      });
      return {
        ok: true,
        data: rows,
        modelText:
          rows
            .map(
              (r) =>
                `- [${new Date(r.createdAt).toISOString()}] (${r.kind}) ${r.summary}`,
            )
            .join("\n") || "No activity.",
      };
    },
  };

  return [project_tree, search_project, read_file, search_activity];
}
