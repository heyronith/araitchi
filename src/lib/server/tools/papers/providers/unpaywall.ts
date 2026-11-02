import "server-only";

import { getProviderBaseUrl } from "../env";
import { normalizeDoi } from "../merge";
import { fetchJson } from "./http";
import { asArr, asObj, asStr, encodeDoiPath } from "./util";

export type UnpaywallResult = {
  isOa: boolean;
  /** Direct PDF of the best legal OA copy, when known. */
  pdfUrl: string | null;
  /** Landing page of the best legal OA copy. */
  url: string | null;
};

export function normalizeUnpaywall(raw: unknown): UnpaywallResult | null {
  const r = asObj(raw);
  if (Object.keys(r).length === 0) return null;
  const best = asObj(r.best_oa_location);
  const locations = asArr(r.oa_locations).map(asObj);
  const pdfUrl =
    asStr(best.url_for_pdf) ??
    locations.map((l) => asStr(l.url_for_pdf)).find((u) => u !== null) ??
    null;
  const url =
    asStr(best.url) ??
    locations.map((l) => asStr(l.url)).find((u) => u !== null) ??
    null;
  return {
    isOa: r.is_oa === true || pdfUrl !== null || url !== null,
    pdfUrl,
    url,
  };
}

/** Find a legal OA copy by DOI. Needs a contact email; never throws (returns null). */
export async function lookupByDoi(
  doi: string,
  opts: { email?: string | null; signal?: AbortSignal },
): Promise<UnpaywallResult | null> {
  const email = opts.email?.trim();
  const clean = normalizeDoi(doi);
  if (!email || !clean) return null;
  try {
    const res = await fetchJson<unknown>(
      `${getProviderBaseUrl("unpaywall")}/${encodeDoiPath(clean)}?email=${encodeURIComponent(email)}`,
      { signal: opts.signal },
    );
    return res.ok ? normalizeUnpaywall(res.data) : null;
  } catch {
    return null;
  }
}
