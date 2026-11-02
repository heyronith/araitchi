import { describe, expect, it } from "vitest";

import { chatRequestSchema } from "@/lib/chat/validation";

describe("chat request validation", () => {
  it("accepts a valid payload", () => {
    const parsed = chatRequestSchema.safeParse({
      chatId: "abc",
      modelId: "openai/gpt-4o-mini",
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects bad modelId", () => {
    const parsed = chatRequestSchema.safeParse({
      chatId: "abc",
      modelId: "not-a-valid-id",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "x" }] },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts council mode without modelId (nullish)", () => {
    const parsed = chatRequestSchema.safeParse({
      chatId: "abc",
      modelId: null,
      mode: "council",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects solo mode without modelId", () => {
    const parsed = chatRequestSchema.safeParse({
      chatId: "abc",
      mode: "solo",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects oversized total text", () => {
    const huge = "x".repeat(500_001);
    const parsed = chatRequestSchema.safeParse({
      chatId: "abc",
      modelId: "openai/gpt-4o",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: huge }] },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
