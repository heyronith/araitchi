/**
 * Fixed, code-only checkers for the benchmark harness.
 * Never evaluate model-written code.
 */

export function normalizeDoi(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  s = s.replace(/^doi:\s*/i, "");
  return s.replace(/\s+/g, "");
}

export function normalizeArxiv(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, "");
  s = s.replace(/^arxiv:\s*/i, "");
  s = s.replace(/\.pdf$/i, "");
  s = s.replace(/v\d+$/i, "");
  return s.trim();
}

export function normalizeEntity(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, "")
    .replace(/\s+/g, " ");
}

export function checkNumeric(
  observed: unknown,
  expected: number,
  tolerance = 0,
): boolean {
  const n =
    typeof observed === "number"
      ? observed
      : typeof observed === "string"
        ? Number(observed.replace(/[^0-9.+-eE]/g, ""))
        : NaN;
  if (!Number.isFinite(n)) return false;
  return Math.abs(n - expected) <= tolerance;
}

export function checkExactEntity(observed: unknown, expected: string): boolean {
  if (observed == null) return false;
  return normalizeEntity(String(observed)) === normalizeEntity(expected);
}

export function checkDoi(observed: unknown, expected: string): boolean {
  if (observed == null) return false;
  return normalizeDoi(String(observed)) === normalizeDoi(expected);
}

export function checkDate(observed: unknown, expected: string): boolean {
  if (observed == null) return false;
  const a = String(observed).trim().slice(0, 10);
  const b = expected.trim().slice(0, 10);
  return a === b;
}

export function extractDoisAndArxiv(text: string): string[] {
  const out = new Set<string>();
  const doiRe = /\b10\.\d{4,9}\/[^\s\]),;"']+/gi;
  for (const m of text.matchAll(doiRe)) {
    out.add(normalizeDoi(m[0]!));
  }
  const arxivRe = /\b(?:arxiv[:\s-]?)(\d{4}\.\d{4,5})(?:v\d+)?\b/gi;
  for (const m of text.matchAll(arxivRe)) {
    out.add(normalizeArxiv(m[1]!));
  }
  return [...out];
}

export function recallAtK(
  predicted: string[],
  gold: string[],
  k: number,
): number {
  if (!gold.length) return 0;
  const pred = predicted.slice(0, k).map((p) => {
    if (p.includes("/") && p.startsWith("10.")) return normalizeDoi(p);
    return normalizeArxiv(p);
  });
  const goldN = gold.map((g) =>
    g.includes("/") && g.startsWith("10.")
      ? normalizeDoi(g)
      : normalizeArxiv(g),
  );
  const set = new Set(pred);
  let hits = 0;
  for (const g of goldN) if (set.has(g)) hits++;
  return hits / goldN.length;
}

export function precisionOfCitations(
  predicted: string[],
  resolvable: Set<string>,
): number {
  if (!predicted.length) return 0;
  let ok = 0;
  for (const p of predicted) {
    const n =
      p.includes("/") && p.startsWith("10.")
        ? normalizeDoi(p)
        : normalizeArxiv(p);
    if (resolvable.has(n)) ok++;
  }
  return ok / predicted.length;
}

export function rediscoveryHit(input: {
  hypotheses: string[];
  requiredTerms: string[];
  goldStatement: string;
  similarity: number;
  similarityThreshold: number;
}): { hit: boolean; borderline: boolean; termScore: number } {
  const top = input.hypotheses.slice(0, 3).join("\n").toLowerCase();
  const terms = input.requiredTerms.map((t) => t.toLowerCase());
  const hits = terms.filter((t) => top.includes(t)).length;
  const termScore = terms.length ? hits / terms.length : 0;
  const simOk = input.similarity >= input.similarityThreshold;
  const termOk = termScore >= 0.6;
  const hit = termOk && simOk;
  const borderline =
    !hit &&
    ((termOk && input.similarity >= input.similarityThreshold - 0.08) ||
      (simOk && termScore >= 0.4));
  return { hit, borderline, termScore };
}

/** Mean and 95% bootstrap CI (percentile). */
export function bootstrapMeanCi(
  samples: number[],
  opts?: { iterations?: number; seed?: number },
): { mean: number; low: number; high: number } {
  if (!samples.length) return { mean: 0, low: 0, high: 0 };
  const iterations = opts?.iterations ?? 1000;
  let state = opts?.seed ?? 42;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < samples.length; j++) {
      sum += samples[Math.floor(rand() * samples.length)]!;
    }
    means.push(sum / samples.length);
  }
  means.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const low = means[Math.floor(0.025 * means.length)]!;
  const high =
    means[Math.min(means.length - 1, Math.floor(0.975 * means.length))]!;
  return { mean, low, high };
}
