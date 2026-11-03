import "server-only";

const MAX_CODE_CHUNK_LINES = 80;

export type TextChunk = {
  startLine: number;
  endLine: number;
  text: string;
};

const TOP_LEVEL_DEF =
  /^(export\s+default\s+)?(export\s+)?(async\s+)?(function\s+\w|class\s+\w|interface\s+\w|type\s+\w|enum\s+\w|def\s+\w|pub\s+(fn|struct|enum|trait|mod)\s|impl\s|mod\s+\w|(const|let|var)\s+\w+\s*=\s*(async\s+)?(\(|function))/;

function sliceLines(
  lines: string[],
  startIdx: number,
  endIdx: number,
): TextChunk {
  const startLine = startIdx + 1;
  const endLine = endIdx + 1;
  return {
    startLine,
    endLine,
    text: lines.slice(startIdx, endIdx + 1).join("\n"),
  };
}

/** Split source into chunks at top-level definitions (~80 lines max). */
export function chunkCode(text: string): TextChunk[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  const boundaries: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      continue;
    }
    if (TOP_LEVEL_DEF.test(trimmed)) {
      if (boundaries[boundaries.length - 1] !== i) {
        boundaries.push(i);
      }
    }
  }

  const chunks: TextChunk[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b]!;
    const nextStart = boundaries[b + 1] ?? lines.length;
    let cursor = start;
    while (cursor < nextStart) {
      const end = Math.min(cursor + MAX_CODE_CHUNK_LINES - 1, nextStart - 1);
      chunks.push(sliceLines(lines, cursor, end));
      cursor = end + 1;
    }
  }

  if (chunks.length === 0) {
    let cursor = 0;
    while (cursor < lines.length) {
      const end = Math.min(cursor + MAX_CODE_CHUNK_LINES - 1, lines.length - 1);
      chunks.push(sliceLines(lines, cursor, end));
      cursor = end + 1;
    }
  }
  return chunks;
}

const HEADING_RE = /^(#{1,6}\s+.+|={3,}|-{3,})\s*$/;

/** Split markdown-ish docs by headings. */
export function chunkDocs(text: string): TextChunk[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  const starts: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (HEADING_RE.test(t) || /^#{1,6}\s/.test(t)) {
      if (starts[starts.length - 1] !== i) starts.push(i);
    }
  }

  const chunks: TextChunk[] = [];
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]!;
    const end = (starts[s + 1] ?? lines.length) - 1;
    if (end >= start) chunks.push(sliceLines(lines, start, end));
  }
  return chunks.length ? chunks : [sliceLines(lines, 0, lines.length - 1)];
}

function firstParagraph(lines: string[]): string {
  const buf: string[] = [];
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (!started) {
      if (!t) continue;
      if (HEADING_RE.test(t) || /^#{1,6}\s/.test(t)) continue;
      started = true;
    }
    if (started && !t) break;
    if (started) buf.push(line);
  }
  return buf.join("\n").trim();
}

function moduleDocstring(text: string): string | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
    const q = trimmed[0];
    const end = trimmed.indexOf(q + q + q, 3);
    if (end > 0) return trimmed.slice(3, end).trim();
  }
  const block = /^\s*\/\*\*([\s\S]*?)\*\//.exec(trimmed);
  if (block) {
    return block[1]!
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .join("\n")
      .trim();
  }
  return null;
}

/** First heading + first paragraph, or module docstring for code. */
export function extractiveSummary(
  text: string,
  kind: "code" | "doc" | "data" | "image" | "other",
): string {
  if (kind === "code") {
    const doc = moduleDocstring(text);
    if (doc) return doc.slice(0, 800);
    const lines = text.split(/\r?\n/).slice(0, 40);
    const comment = lines
      .filter((l) => /^\s*(#|\/\/)/.test(l))
      .slice(0, 5)
      .join("\n")
      .trim();
    return (comment || firstParagraph(lines)).slice(0, 800);
  }
  const lines = text.split(/\r?\n/);
  let heading = "";
  for (const line of lines) {
    const t = line.trim();
    if (/^#{1,6}\s+/.test(t)) {
      heading = t.replace(/^#+\s*/, "");
      break;
    }
  }
  const para = firstParagraph(lines);
  if (heading && para) return `${heading}\n\n${para}`.slice(0, 800);
  return (heading || para || text.slice(0, 400)).slice(0, 800);
}
