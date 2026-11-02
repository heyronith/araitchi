export type PaperProvider =
  | "openalex"
  | "core"
  | "semantic_scholar"
  | "arxiv"
  | "dblp"
  | "openreview"
  | "crossref"
  | "unpaywall";

export type Paper = {
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  doi: string | null;
  arxivId: string | null;
  url: string | null;
  pdfUrl: string | null;
  citationCount: number | null;
  foundBy: PaperProvider[];
};

export type ProviderSearchResult = {
  provider: PaperProvider;
  ok: boolean;
  error?: string;
  papers: Paper[];
  latencyMs: number;
};
