import "server-only";

import { z } from "zod";

import { getRecord, listRecords } from "@/lib/server/project/records";
import { hybridSearch } from "@/lib/server/memory/search";
import { listLibraryDocuments } from "@/lib/server/tools/documents/store";

import type { RegisteredTool } from "../types";

export function createMemoryTools(): RegisteredTool[] {
  const search_memory: RegisteredTool = {
    name: "search_memory",
    description:
      "Search the project notebook (records, session summaries, document chunks, papers) with hybrid semantic + keyword ranking.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      types: z
        .array(z.enum(["record", "session_summary", "doc_chunk", "paper"]))
        .max(4)
        .optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    kind: "read",
    provider: "memory",
    ttlSec: 0,
    handler: async (args, ctx) => {
      const { hits, vectorUsed } = await hybridSearch(ctx.projectPath, {
        query: args.query,
        types: args.types,
        limit: args.limit ?? 10,
        excludeChatId: ctx.chatId,
      });
      return {
        ok: true,
        data: {
          vectorUsed,
          results: hits.map((h) => ({
            ownerType: h.ownerType,
            ownerId: h.ownerId,
            chunkIdx: h.chunkIdx,
            score: h.score,
            text: h.text.slice(0, 1200),
            meta: h.meta,
          })),
        },
        modelText:
          hits
            .map(
              (h, i) =>
                `[${i + 1}] (${h.ownerType}/${h.ownerId}) score=${h.score.toFixed(3)}\n${h.text.slice(0, 600)}`,
            )
            .join("\n\n") || "No matches.",
      };
    },
  };

  const get_record: RegisteredTool = {
    name: "get_record",
    description: "Fetch a single memory record by id.",
    inputSchema: z.object({ id: z.string().min(1).max(64) }),
    kind: "read",
    provider: "memory",
    ttlSec: 0,
    handler: async (args, ctx) => {
      const rec = getRecord(ctx.projectPath, args.id);
      if (!rec || rec.deletedAt) {
        return { ok: false, error: `Record not found: ${args.id}` };
      }
      return {
        ok: true,
        data: rec,
        modelText: `[${rec.type}] ${rec.title}\nstatus=${rec.status ?? "—"}\n${rec.body}`,
      };
    },
  };

  const list_hypotheses: RegisteredTool = {
    name: "list_hypotheses",
    description: "List project hypotheses, optionally filtered by status.",
    inputSchema: z.object({
      status: z
        .enum(["proposed", "testing", "supported", "refuted", "inconclusive"])
        .optional(),
    }),
    kind: "read",
    provider: "memory",
    ttlSec: 0,
    handler: async (args, ctx) => {
      let rows = listRecords(ctx.projectPath, { type: "hypothesis" });
      if (args.status) rows = rows.filter((r) => r.status === args.status);
      return {
        ok: true,
        data: rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          body: r.body.slice(0, 400),
        })),
        modelText:
          rows.map((r) => `- ${r.id} [${r.status}] ${r.title}`).join("\n") ||
          "No hypotheses.",
      };
    },
  };

  const list_experiments: RegisteredTool = {
    name: "list_experiments",
    description: "List project experiments, optionally filtered by status.",
    inputSchema: z.object({
      status: z.enum(["planned", "running", "done"]).optional(),
    }),
    kind: "read",
    provider: "memory",
    ttlSec: 0,
    handler: async (args, ctx) => {
      let rows = listRecords(ctx.projectPath, { type: "experiment" });
      if (args.status) rows = rows.filter((r) => r.status === args.status);
      return {
        ok: true,
        data: rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          body: r.body.slice(0, 400),
        })),
        modelText:
          rows.map((r) => `- ${r.id} [${r.status}] ${r.title}`).join("\n") ||
          "No experiments.",
      };
    },
  };

  const search_library: RegisteredTool = {
    name: "search_library",
    description:
      "Search uploaded library documents and indexed chunks by query.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
    }),
    kind: "read",
    provider: "memory",
    ttlSec: 0,
    handler: async (args, ctx) => {
      const docs = listLibraryDocuments(ctx.projectPath);
      const q = args.query.toLowerCase();
      const matched = docs.filter(
        (d) =>
          d.filename.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q),
      );
      const { hits } = await hybridSearch(ctx.projectPath, {
        query: args.query,
        types: ["doc_chunk", "paper"],
        limit: 10,
      });
      return {
        ok: true,
        data: {
          documents: matched.map((d) => ({
            id: d.id,
            filename: d.filename,
            pageCount: d.pageCount,
          })),
          chunks: hits.map((h) => ({
            ownerId: h.ownerId,
            chunkIdx: h.chunkIdx,
            text: h.text.slice(0, 800),
            score: h.score,
          })),
        },
        modelText:
          [
            ...matched.map((d) => `doc ${d.id}: ${d.filename}`),
            ...hits.map(
              (h, i) =>
                `chunk[${i}] ${h.ownerId}#${h.chunkIdx}: ${h.text.slice(0, 200)}`,
            ),
          ].join("\n") || "No library matches.",
      };
    },
  };

  return [
    search_memory,
    get_record,
    list_hypotheses,
    list_experiments,
    search_library,
  ];
}
