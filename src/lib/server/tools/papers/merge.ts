import type { Paper, PaperProvider } from "./types";

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const cleaned = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeArxivId(id: string | null | undefined): string | null {
  if (!id) return null;
  const cleaned = id
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, "")
    .replace(/^arxiv:\s*/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "")
    .trim()
    .toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

/** Primary dedupe key: DOI, else arXiv id (no version), else title + year. */
export function fingerprint(paper: Paper): string {
  const doi = normalizeDoi(paper.doi);
  if (doi) return `doi:${doi}`;
  const arxiv = normalizeArxivId(paper.arxivId);
  if (arxiv) return `arxiv:${arxiv}`;
  return titleKey(paper);
}

function titleKey(paper: Paper): string {
  return `title:${normalizeTitle(paper.title)}|${paper.year ?? ""}`;
}

/** All keys a paper can be matched by (a DOI-less preprint can still match a DOI record via arXiv id or title). */
function allKeys(paper: Paper): string[] {
  const keys: string[] = [];
  const doi = normalizeDoi(paper.doi);
  if (doi) keys.push(`doi:${doi}`);
  const arxiv = normalizeArxivId(paper.arxivId);
  if (arxiv) keys.push(`arxiv:${arxiv}`);
  if (normalizeTitle(paper.title).length > 0) keys.push(titleKey(paper));
  return keys;
}

/** Assign a group id to each paper; papers sharing any key end up in the same group. */
function groupByKeys(papers: Paper[]): number[] {
  const parent = papers.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const owner = new Map<string, number>();
  papers.forEach((paper, i) => {
    for (const key of allKeys(paper)) {
      const existing = owner.get(key);
      if (existing === undefined) {
        owner.set(key, i);
      } else {
        const a = find(existing);
        const b = find(i);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  return papers.map((_, i) => find(i));
}

function pickLonger(a: string | null, b: string | null): string | null {
  if (a && b) return b.length > a.length ? b : a;
  return a ?? b;
}

function unionProviders(
  a: PaperProvider[],
  b: PaperProvider[],
): PaperProvider[] {
  const out = [...a];
  for (const p of b) if (!out.includes(p)) out.push(p);
  return out;
}

function mergeTwo(base: Paper, other: Paper): Paper {
  return {
    title: base.title || other.title,
    authors:
      other.authors.length > base.authors.length ? other.authors : base.authors,
    year: base.year ?? other.year,
    venue: base.venue ?? other.venue,
    abstract: pickLonger(base.abstract, other.abstract),
    doi: normalizeDoi(base.doi) ?? normalizeDoi(other.doi),
    arxivId: normalizeArxivId(base.arxivId) ?? normalizeArxivId(other.arxivId),
    url: base.url ?? other.url,
    pdfUrl: base.pdfUrl ?? other.pdfUrl,
    citationCount:
      base.citationCount !== null && other.citationCount !== null
        ? Math.max(base.citationCount, other.citationCount)
        : (base.citationCount ?? other.citationCount),
    foundBy: unionProviders(base.foundBy, other.foundBy),
  };
}

function mergeGroup(papers: Paper[]): Paper {
  return papers.slice(1).reduce(mergeTwo, {
    ...papers[0],
    foundBy: [...papers[0].foundBy],
  });
}

/** Merge papers across lists by fingerprint; unions `foundBy`, prefers non-null fields. */
export function mergePapers(lists: Paper[][]): Paper[] {
  const flat = lists.flat();
  const groups = groupByKeys(flat);
  const byGroup = new Map<number, Paper[]>();
  flat.forEach((paper, i) => {
    const members = byGroup.get(groups[i]);
    if (members) members.push(paper);
    else byGroup.set(groups[i], [paper]);
  });
  return [...byGroup.values()].map(mergeGroup);
}

/**
 * Reciprocal rank fusion across ranked lists (one per provider), merging
 * duplicates. Papers found by several providers get a small extra boost.
 */
export function rrfRank(rankedLists: Paper[][], k = 60): Paper[] {
  const flat: { paper: Paper; rank: number; list: number }[] = [];
  rankedLists.forEach((list, li) =>
    list.forEach((paper, rank) => flat.push({ paper, rank, list: li })),
  );
  const groups = groupByKeys(flat.map((f) => f.paper));

  const grouped = new Map<
    number,
    { papers: Paper[]; bestRankPerList: Map<number, number> }
  >();
  flat.forEach((item, i) => {
    const gid = groups[i];
    let entry = grouped.get(gid);
    if (!entry) {
      entry = { papers: [], bestRankPerList: new Map() };
      grouped.set(gid, entry);
    }
    entry.papers.push(item.paper);
    const best = entry.bestRankPerList.get(item.list);
    if (best === undefined || item.rank < best) {
      entry.bestRankPerList.set(item.list, item.rank);
    }
  });

  const scored = [...grouped.values()].map((entry, order) => {
    const paper = mergeGroup(entry.papers);
    let score = 0;
    for (const rank of entry.bestRankPerList.values()) {
      score += 1 / (k + rank + 1);
    }
    score += 0.05 * Math.max(0, paper.foundBy.length - 1);
    return { paper, score, order };
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.paper);
}
