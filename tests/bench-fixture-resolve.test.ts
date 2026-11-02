import { describe, expect, it, vi } from "vitest";

import {
  crossrefWorksUrl,
  resolveBenchDoi,
  resolveViaCrossref,
  resolveViaDoiHandle,
  resolveViaArxiv,
} from "@/lib/server/bench/validate-fixtures";

describe("bench fixture DOI resolution", () => {
  it("builds Crossref works URL with optional mailto", () => {
    expect(crossrefWorksUrl("10.1234/example")).toBe(
      "https://api.crossref.org/works/10.1234%2Fexample",
    );
    expect(crossrefWorksUrl("10.1234/example", "a@b.co")).toBe(
      "https://api.crossref.org/works/10.1234%2Fexample?mailto=a%40b.co",
    );
  });

  it("resolveViaCrossref treats HTTP 200 as resolved", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    await expect(
      resolveViaCrossref("10.1234/abc", {
        fetch: fetchMock,
        mailto: "user@example.com",
      }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.crossref.org/works/10.1234%2Fabc?mailto=user%40example.com",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("resolveViaCrossref treats HTTP 404 as unresolved", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: false, status: 404 }) as Response,
    );
    await expect(
      resolveViaCrossref("10.1234/missing", { fetch: fetchMock }),
    ).resolves.toBe(false);
  });

  it("resolveViaDoiHandle checks responseCode", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ responseCode: 1 }),
    })) as unknown as typeof fetch;
    await expect(
      resolveViaDoiHandle("10.48550/arxiv.1706.03762", { fetch: fetchMock }),
    ).resolves.toBe(true);
  });

  it("resolveViaArxiv detects entries in Atom feed", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><feed><opensearch:totalResults>1</opensearch:totalResults><entry></entry></feed>',
    })) as unknown as typeof fetch;
    await expect(
      resolveViaArxiv("1706.03762", { fetch: fetchMock }),
    ).resolves.toBe(true);
  });

  it("resolveBenchDoi falls back from Crossref to handle API", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        urls.push(url);
        if (url.includes("api.crossref.org")) {
          return { ok: false, status: 404 } as Response;
        }
        return {
          ok: true,
          json: async () => ({ responseCode: 1 }),
        } as Response;
      },
    );
    await expect(
      resolveBenchDoi("10.48550/arxiv.9999.99999", {
        fetch: fetchMock as typeof fetch,
      }),
    ).resolves.toBe(true);
    expect(urls.some((u) => u.includes("api.crossref.org"))).toBe(true);
    expect(urls.some((u) => u.includes("doi.org/api/handles"))).toBe(true);
  });
});
