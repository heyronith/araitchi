import type { PaperProvider } from "./types";

export const DEFAULT_PROVIDER_BASE_URLS: Record<PaperProvider, string> = {
  openalex: "https://api.openalex.org",
  core: "https://api.core.ac.uk/v3",
  semantic_scholar: "https://api.semanticscholar.org/graph/v1",
  arxiv: "http://export.arxiv.org/api",
  dblp: "https://dblp.org/search/publ/api",
  openreview: "https://api2.openreview.net",
  crossref: "https://api.crossref.org",
  unpaywall: "https://api.unpaywall.org/v2",
};

/**
 * Base URL for a provider. Overridable via `ARAITCHI_<NAME>_BASE_URL`
 * (e.g. `ARAITCHI_SEMANTIC_SCHOLAR_BASE_URL`) so tests can point at a mock.
 */
export function getProviderBaseUrl(name: PaperProvider): string {
  const envKey = `ARAITCHI_${name.toUpperCase()}_BASE_URL`;
  const override = process.env[envKey]?.trim();
  const base =
    override && override.length > 0
      ? override
      : DEFAULT_PROVIDER_BASE_URLS[name];
  return base.replace(/\/+$/, "");
}
