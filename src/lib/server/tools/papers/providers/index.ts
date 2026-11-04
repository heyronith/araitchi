import "server-only";

export {
  normalizeArxiv,
  normalizeArxivXml,
  fetchArxivPaper,
  searchArxiv,
} from "./arxiv";
export { normalizeCore, searchCore } from "./core";
export {
  fetchCrossrefWork,
  fetchCrossrefWorkDetailed,
  normalizeCrossref,
  searchCrossref,
} from "./crossref";
export { normalizeDblp, searchDblp } from "./dblp";
export {
  consumeOpenAlexSearchMeta,
  fetchOpenAlexLinks,
  fetchOpenAlexWork,
  fetchOpenAlexWorkDetailed,
  normalizeOpenAlex,
  refreshOpenAlexBudget,
  searchOpenAlex,
  searchOpenAlexSemantic,
} from "./openalex";
export {
  formatOpenAlexBudgetLine,
  getOpenAlexMode,
  loadOpenAlexBudget,
  type OpenAlexBudget,
  type OpenAlexMode,
} from "./openalex-budget";
export { normalizeOpenReview, searchOpenReview } from "./openreview";
export {
  fetchSemanticScholarLinks,
  fetchSemanticScholarPaper,
  fetchSemanticScholarPaperDetailed,
  normalizeSemanticScholar,
  normalizeSemanticScholarPaper,
  searchSemanticScholar,
} from "./semantic-scholar";
export {
  lookupByDoi,
  lookupByDoi as lookupUnpaywall,
  normalizeUnpaywall,
  type UnpaywallResult,
} from "./unpaywall";
export type { ProviderSearchOpts } from "./util";
