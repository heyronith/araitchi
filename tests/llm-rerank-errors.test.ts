import { describe, expect, it } from "vitest";

import { sanitizeLlmError } from "../src/lib/server/tools/papers/enhance";

describe("sanitizeLlmError", () => {
  it("redacts openrouter key URLs and sk keys", () => {
    const msg = sanitizeLlmError(
      new Error(
        "Key limit exceeded. Manage it using https://openrouter.ai/workspaces/default/keys/abc123deadbeef $10 of $10 used",
      ),
    );
    expect(msg).toContain("[openrouter-key-url]");
    expect(msg).not.toContain("keys/abc123");
    expect(sanitizeLlmError("sk-or-v1-secrettokenhere")).toContain(
      "[redacted-key]",
    );
  });
});
