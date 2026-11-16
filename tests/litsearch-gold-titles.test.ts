import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  goldTitlesForQuery,
  type LitQueryRow,
  zeroGoldTitleIndices,
} from "../scripts/litsearch-corpus";

describe("litsearch gold titles", () => {
  it("fails when any of 100 eval queries resolves to zero gold titles", () => {
    const queries: LitQueryRow[] = Array.from({ length: 100 }, (_, i) => ({
      query: `query ${i}`,
      corpusids: [1000 + i],
    }));
    // Incomplete corpus (the freeze bug): only 9 titles present.
    const incomplete = new Map<number, string>();
    for (let i = 0; i < 9; i++) incomplete.set(1000 + i, `Title ${i}`);
    expect(zeroGoldTitleIndices(queries, incomplete).length).toBe(91);

    const complete = new Map<number, string>();
    for (const q of queries) {
      for (const id of q.corpusids) complete.set(id, `Title ${id}`);
    }
    expect(zeroGoldTitleIndices(queries, complete)).toEqual([]);
  });

  it("real eval cache: every of the first 100 queries has ≥1 gold title", () => {
    const cacheDir = path.join(process.cwd(), "evals/cache");
    const qPath = path.join(cacheDir, "litsearch-queries.json");
    const cPath = path.join(cacheDir, "litsearch-corpus-index.json");
    if (!existsSync(qPath) || !existsSync(cPath)) {
      // CI / fresh clone without warmed caches — unit test above still guards the invariant.
      return;
    }
    const queries = (
      JSON.parse(readFileSync(qPath, "utf8")) as LitQueryRow[]
    ).slice(0, 100);
    const obj = JSON.parse(readFileSync(cPath, "utf8")) as Record<
      string,
      string
    >;
    const corpus = new Map<number, string>();
    for (const [k, v] of Object.entries(obj)) {
      if (v?.trim()) corpus.set(Number(k), v.trim());
    }
    const zero = zeroGoldTitleIndices(queries, corpus);
    expect(
      zero,
      `zero-gold query indices: ${zero.join(",")}. Re-run freeze (ensureCorpusTitles) to rebuild litsearch-corpus-index.json`,
    ).toEqual([]);
    for (const q of queries) {
      expect(goldTitlesForQuery(q, corpus).length).toBeGreaterThan(0);
    }
  });
});
