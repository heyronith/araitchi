import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "@/lib/server/tools/papers/providers/http";

describe("fetchJson", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns rate_limited after retries on HTTP 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("slow down", { status: 429 })),
    );
    const p = fetchJson("https://example.com/x", { retries: 2 });
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res).toMatchObject({
      ok: false,
      error: "rate_limited",
      status: 429,
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After before retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response("wait", {
            status: 429,
            headers: { "Retry-After": "2" },
          }),
        )
        .mockResolvedValueOnce(
          new Response('{"ok":true}', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    const p = fetchJson("https://example.com/x", { retries: 2 });
    await vi.advanceTimersByTimeAsync(2000);
    const res = await p;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ ok: true });
  });

  it("rejects non-JSON content-type with invalid_json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    const res = await fetchJson("https://example.com/x", { retries: 0 });
    expect(res).toMatchObject({ ok: false, error: "invalid_json" });
  });
});
