import { z } from "zod";

/** OpenRouter ids, including optional `~` "latest" aliases. */
export const MODEL_ID_RE = /^~?[\w.-]+\/[\w.:-]+$/;

export const chatMessagePartSchema = z
  .object({
    type: z.string(),
    text: z.string().optional(),
  })
  .passthrough();

export const chatUiMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(chatMessagePartSchema).default([]),
  content: z.string().optional(),
});

export const toolTogglesSchema = z.object({
  papers: z.boolean().optional(),
  web: z.boolean().optional(),
  documents: z.boolean().optional(),
  repo: z.boolean().optional(),
  mcp: z.boolean().optional(),
  memory: z.boolean().optional(),
});

export const chatRequestSchema = z
  .object({
    chatId: z.string().min(1).max(128),
    modelId: z.string().regex(MODEL_ID_RE, "Invalid modelId").nullish(),
    mode: z.enum(["solo", "auto", "council"]).optional().default("auto"),
    allowOverBudget: z.boolean().optional(),
    tools: toolTogglesSchema.optional(),
    toolApprovals: z.record(z.string(), z.boolean()).optional(),
    /** Force re-run as a specific action (from Why? chip). */
    forceAction: z
      .enum(["solo", "council", "probe", "retrieve_evidence"])
      .optional(),
    messages: z.array(chatUiMessageSchema).min(1).max(200),
    parentId: z.string().nullable().optional(),
    id: z.string().optional(),
    trigger: z.string().optional(),
    messageId: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "solo" && !val.modelId) {
      ctx.addIssue({
        code: "custom",
        message: "modelId is required in solo mode",
        path: ["modelId"],
      });
    }
    let total = 0;
    for (const m of val.messages) {
      if (typeof m.content === "string") total += m.content.length;
      for (const p of m.parts) {
        if (typeof p.text === "string") total += p.text.length;
      }
    }
    if (total > 500_000) {
      ctx.addIssue({
        code: "custom",
        message: "Total message text exceeds 500k characters",
        path: ["messages"],
      });
    }
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;
