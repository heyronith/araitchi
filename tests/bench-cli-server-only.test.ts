import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bench CLI server-only stub", () => {
  it("registers a server-only stub for live tsx runs", () => {
    const bench = readFileSync("scripts/bench.mjs", "utf8");
    expect(bench).toMatch(/register-server-only\.mjs/);
    expect(bench).toMatch(/pathToFileURL/);
    const stub = readFileSync("scripts/stubs/server-only.js", "utf8");
    expect(stub.length).toBeGreaterThan(0);
  });
});
