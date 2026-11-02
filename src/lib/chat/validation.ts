import { z } from "zod";

export const MODEL_ID_RE = /^[\w.-]+\/[\w.:-]+$/;

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

export const chatRequestSchema = z
  .object({
    chatId: z.string().min(1).max(128),
    modelId: z.string().regex(MODEL_ID_RE, "Invalid modelId").nullish(),
    mode: z.enum(["solo", "council"]).optional().default("solo"),
    allowOverBudget: z.boolean().optional(),
    messages: z.array(chatUiMessageSchema).min(1).max(200),
    parentId: z.string().nullable().optional(),
    id: z.string().optional(),
    trigger: z.string().optional(),
    messageId: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode !== "council" && !val.modelId) {
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
