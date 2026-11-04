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
  fetchOpenAlexLinks,
  fetchOpenAlexWork,
  fetchOpenAlexWorkDetailed,
  normalizeOpenAlex,
  searchOpenAlex,
} from "./openalex";
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
