import { createHash } from "node:crypto";

/** Cosine similarity for L2-normalized or raw float vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function float32ToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function bufferToFloat32(buf: Buffer): Float32Array {
  const aligned = Buffer.from(buf);
  return new Float32Array(
    aligned.buffer,
    aligned.byteOffset,
    aligned.byteLength / 4,
  );
}

export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** Reciprocal rank fusion across ranked id lists. */
export function rrfMerge(
  lists: { id: string; score?: number }[][],
  k = 60,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  lists.forEach((list) => {
    list.forEach((item, rank) => {
      const prev = scores.get(item.id) ?? 0;
      scores.set(item.id, prev + 1 / (k + rank + 1));
    });
  });
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/** Deterministic fake embedding from text (unit-ish vector). */
export function fakeEmbed(text: string, dims = 32): Float32Array {
  const out = new Float32Array(dims);
  const h = createHash("sha256").update(text.toLowerCase().trim()).digest();
  for (let i = 0; i < dims; i++) {
    out[i] = ((h[i % h.length]! / 255) * 2 - 1) * (1 + (i % 7) * 0.01);
  }
  // Mix in token presence for better lexical separation in tests
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const t of tokens) {
    let s = 0;
    for (let i = 0; i < t.length; i++) s = (s * 31 + t.charCodeAt(i)) >>> 0;
    out[s % dims]! += 1.5;
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += out[i]! * out[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) out[i]! /= norm;
  return out;
}
