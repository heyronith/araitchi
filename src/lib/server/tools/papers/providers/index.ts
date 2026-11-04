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
  normalizeCrossref,
  searchCrossref,
} from "./crossref";
export { normalizeDblp, searchDblp } from "./dblp";
export {
  fetchOpenAlexLinks,
  fetchOpenAlexWork,
  normalizeOpenAlex,
  searchOpenAlex,
} from "./openalex";
export { normalizeOpenReview, searchOpenReview } from "./openreview";
export {
  fetchSemanticScholarLinks,
  fetchSemanticScholarPaper,
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
