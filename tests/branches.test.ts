import { describe, expect, it } from "vitest";

import {
  buildMessageForest,
  getBranchMeta,
  resolveActiveBranch,
  type StoredMessage,
} from "@/lib/chat/branches";

function msg(
  partial: Partial<StoredMessage> & Pick<StoredMessage, "id" | "role">,
): StoredMessage {
  return {
    chatId: "c1",
    parentId: null,
    parts: [{ type: "text", text: partial.id }],
    modelId: null,
    usage: null,
    createdAt: Number(partial.id.replace(/\D/g, "") || 1),
    ...partial,
  };
}

describe("message branches", () => {
  it("builds a forest and resolves the active leaf path", () => {
    const messages = [
      msg({ id: "u1", role: "user", createdAt: 1 }),
      msg({ id: "a1", role: "assistant", parentId: "u1", createdAt: 2 }),
      msg({ id: "a2", role: "assistant", parentId: "u1", createdAt: 3 }),
      msg({ id: "u2", role: "user", parentId: "a2", createdAt: 4 }),
    ];

    const forest = buildMessageForest(messages);
    expect(forest).toHaveLength(1);
    expect(forest[0]!.children).toHaveLength(2);

    const latest = resolveActiveBranch(messages);
    expect(latest.map((m) => m.id)).toEqual(["u1", "a2", "u2"]);

    const viaLeaf = resolveActiveBranch(messages, "a1");
    expect(viaLeaf.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("reports sibling branch indexes", () => {
    const messages = [
      msg({ id: "u1", role: "user", createdAt: 1 }),
      msg({ id: "a1", role: "assistant", parentId: "u1", createdAt: 2 }),
      msg({ id: "a2", role: "assistant", parentId: "u1", createdAt: 3 }),
    ];
    expect(getBranchMeta(messages, "a1")).toEqual({ index: 1, total: 2 });
    expect(getBranchMeta(messages, "a2")).toEqual({ index: 2, total: 2 });
  });
});
