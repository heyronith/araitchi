import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("OpenRouter model defaults", () => {
  it("does not ship the invalid ~openai/gpt-oss-latest alias in eval scripts", () => {
    const gate = readFileSync("scripts/eval-gate.mjs", "utf8");
    const scribe = readFileSync("scripts/eval-scribe.mjs", "utf8");
    expect(gate).not.toMatch(/~openai\/gpt-oss-latest/);
    expect(scribe).not.toMatch(/~openai\/gpt-oss-latest/);
  });

  it("documents that config/defaults.json still needs owner decision on gpt-oss alias", () => {
    const defaults = JSON.parse(readFileSync("config/defaults.json", "utf8"));
    // Known-broken alias observed live on OpenRouter (400: not a valid model ID).
    // Lead decides replacement (openai/gpt-oss-20b is a working pin).
    expect(typeof defaults.classifierModel).toBe("string");
    expect(typeof defaults.scribeModel).toBe("string");
  });
});
