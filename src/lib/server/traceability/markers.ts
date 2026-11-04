import "server-only";

export type MarkerKind = "paper" | "memory" | "tool" | "file" | "experiment";

export type ParsedMarker = {
  raw: string;
  kind: MarkerKind;
  /** e.g. "7" for [P-7], or path for files */
  ref: string;
  startLine?: number;
  endLine?: number;
  index: number;
  valid: boolean;
};

export type SourceCatalog = {
  papers?: Set<string>; // "7", "P-7", dois…
  memory?: Set<string>; // "H-12", "12", "D-3"
  tools?: Set<string>;
  files?: Set<string>; // paths
  experiments?: Set<string>;
};

const MARKER_RE =
  /\[(P|H|D|Q|N|T|E)-(\d+)\]|\[F:([^\]#]+)(?:#L(\d+)(?:-(\d+))?)?\]/g;

export function parseMarkers(
  text: string,
  catalog?: SourceCatalog,
): ParsedMarker[] {
  const out: ParsedMarker[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const index = m.index ?? 0;
    const raw = m[0]!;
    if (m[1]) {
      const prefix = m[1]!;
      const num = m[2]!;
      const kind: MarkerKind =
        prefix === "P"
          ? "paper"
          : prefix === "T"
            ? "tool"
            : prefix === "E"
              ? "experiment"
              : "memory";
      const ref = `${prefix}-${num}`;
      let valid = true;
      if (catalog) {
        if (kind === "paper") {
          valid =
            !catalog.papers ||
            catalog.papers.has(num) ||
            catalog.papers.has(ref) ||
            catalog.papers.has(`P-${num}`);
        } else if (kind === "tool") {
          valid =
            !catalog.tools || catalog.tools.has(num) || catalog.tools.has(ref);
        } else if (kind === "experiment") {
          valid =
            !catalog.experiments ||
            catalog.experiments.has(num) ||
            catalog.experiments.has(ref);
        } else {
          valid =
            !catalog.memory ||
            catalog.memory.has(num) ||
            catalog.memory.has(ref) ||
            catalog.memory.has(`${prefix}-${num}`);
        }
      }
      out.push({ raw, kind, ref, index, valid });
    } else {
      const filePath = (m[3] ?? "").trim();
      const startLine = m[4] ? Number(m[4]) : undefined;
      const endLine = m[5] ? Number(m[5]) : startLine;
      let valid = true;
      if (catalog?.files) {
        valid =
          catalog.files.has(filePath) ||
          [...catalog.files].some(
            (f) =>
              f === filePath || filePath.endsWith(f) || f.endsWith(filePath),
          );
      }
      out.push({
        raw,
        kind: "file",
        ref: filePath,
        startLine,
        endLine,
        index,
        valid,
      });
    }
  }
  return out;
}

export type SentenceTrace = {
  text: string;
  index: number;
  markers: ParsedMarker[];
  sourced: boolean;
  /** True when sentence has no markers → model reasoning. */
  modelReasoning: boolean;
  invalidMarkers: ParsedMarker[];
};

/** Split on sentence boundaries; attach markers that fall inside each span. */
export function traceSentences(
  text: string,
  catalog?: SourceCatalog,
): {
  sentences: SentenceTrace[];
  sourcedCount: number;
  total: number;
  claimMap: { sentence: string; markers: string[] }[];
} {
  const markers = parseMarkers(text, catalog);
  const sentences: SentenceTrace[] = [];
  const re = /[^.!?\n]+[.!?]+|[^.!?\n]+$/g;
  for (const m of text.matchAll(re)) {
    const chunk = m[0]!;
    if (!chunk.trim()) continue;
    const start = m.index ?? 0;
    const end = start + chunk.length;
    const inSentence = markers.filter(
      (mk) => mk.index >= start && mk.index < end,
    );
    const invalidMarkers = inSentence.filter((mk) => !mk.valid);
    const sourced = inSentence.some((mk) => mk.valid);
    sentences.push({
      text: chunk.trim(),
      index: start,
      markers: inSentence,
      sourced,
      modelReasoning: inSentence.length === 0,
      invalidMarkers,
    });
  }
  const sourcedCount = sentences.filter((s) => s.sourced).length;
  return {
    sentences,
    sourcedCount,
    total: sentences.length,
    claimMap: sentences.map((s) => ({
      sentence: s.text,
      markers: s.markers.map((mk) => mk.raw),
    })),
  };
}

export function formatTraceabilityFooter(
  sourced: number,
  total: number,
): string {
  if (total === 0) return "Traceability: 0/0 sentences sourced";
  return `Traceability: ${sourced}/${total} sentences sourced`;
}
