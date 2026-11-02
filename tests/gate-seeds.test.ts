import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import seeds from "@/lib/server/gate/seed-examples.json";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

describe("gate seed-examples quality", () => {
  it("has ≥325 unique texts after normalisation and ≥25 per task type", () => {
    expect(seeds.length).toBeGreaterThanOrEqual(325);
    const norms = seeds.map((s) => normalize(s.text));
    expect(new Set(norms).size).toBe(seeds.length);

    const byType = new Map<string, number>();
    for (const s of seeds) {
      byType.set(s.taskType, (byType.get(s.taskType) ?? 0) + 1);
    }
    for (const [t, n] of byType) {
      expect(n, t).toBeGreaterThanOrEqual(25);
    }
  });

  it("has zero text overlap with evals/gate fixtures", () => {
    const seedSet = new Set(seeds.map((s) => normalize(s.text)));
    const evalDir = path.join(process.cwd(), "evals/gate");
    const evalNorms: string[] = [];
    for (const f of readdirSync(evalDir).filter((x) => x.endsWith(".json"))) {
      const chunk = JSON.parse(readFileSync(path.join(evalDir, f), "utf8")) as
        { text?: string }[] | { text?: string };
      for (const e of Array.isArray(chunk) ? chunk : [chunk]) {
        if (e.text) evalNorms.push(normalize(e.text));
      }
    }
    const overlap = evalNorms.filter((t) => seedSet.has(t));
    expect(overlap).toEqual([]);
  });
});
