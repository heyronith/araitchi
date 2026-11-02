import "server-only";

const DEFAULT_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export type FetchJsonResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; contentType?: string };

function parseRetryAfterMs(header: string | null): number | null {
  if (!header?.trim()) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    base === "application/json" ||
    base === "application/ld+json" ||
    base.endsWith("+json")
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

async function fetchOnce(
  url: string,
  opts: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, {
      headers: opts.headers,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
  },
): Promise<FetchJsonResult<T>> {
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const maxAttempts = (opts?.retries ?? DEFAULT_RETRIES) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchOnce(url, {
        headers: opts?.headers,
        signal: opts?.signal,
        timeoutMs,
      });
      const contentType = res.headers.get("content-type");

      if (!res.ok) {
        if (retryableStatus(res.status) && attempt < maxAttempts - 1) {
          const retryAfter =
            parseRetryAfterMs(res.headers.get("Retry-After")) ??
            BASE_BACKOFF_MS * 2 ** attempt;
          await sleep(retryAfter, opts?.signal);
          continue;
        }
        if (res.status === 429) {
          return {
            ok: false,
            error: "rate_limited",
            status: 429,
            contentType: contentType ?? undefined,
          };
        }
        return {
          ok: false,
          error: `HTTP ${res.status}`,
          status: res.status,
          contentType: contentType ?? undefined,
        };
      }

      const text = await res.text();
      if (!isJsonContentType(contentType)) {
        const peek = text.slice(0, 120).toLowerCase();
        if (
          contentType?.toLowerCase().includes("text/html") ||
          peek.includes("<!doctype") ||
          peek.includes("not a bot")
        ) {
          return {
            ok: false,
            error: "invalid_json",
            status: res.status,
            contentType: contentType ?? "text/html",
          };
        }
        return {
          ok: false,
          error: "invalid_json",
          status: res.status,
          contentType: contentType ?? undefined,
        };
      }

      try {
        return { ok: true, data: JSON.parse(text) as T };
      } catch {
        return {
          ok: false,
          error: "invalid_json",
          status: res.status,
          contentType: contentType ?? undefined,
        };
      }
    } catch (e) {
      if (opts?.signal?.aborted) {
        return { ok: false, error: "Aborted" };
      }
      if (attempt < maxAttempts - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt, opts?.signal);
        continue;
      }
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Fetch failed",
      };
    }
  }

  return { ok: false, error: "Fetch failed" };
}

export async function fetchText(
  url: string,
  opts?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
  },
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const maxAttempts = (opts?.retries ?? DEFAULT_RETRIES) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchOnce(url, {
        headers: opts?.headers,
        signal: opts?.signal,
        timeoutMs,
      });
      if (!res.ok) {
        if (retryableStatus(res.status) && attempt < maxAttempts - 1) {
          const retryAfter =
            parseRetryAfterMs(res.headers.get("Retry-After")) ??
            BASE_BACKOFF_MS * 2 ** attempt;
          await sleep(retryAfter, opts?.signal);
          continue;
        }
        if (res.status === 429) return { ok: false, error: "rate_limited" };
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true, text: await res.text() };
    } catch (e) {
      if (opts?.signal?.aborted) return { ok: false, error: "Aborted" };
      if (attempt < maxAttempts - 1) {
        await sleep(BASE_BACKOFF_MS * 2 ** attempt, opts?.signal);
        continue;
      }
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Fetch failed",
      };
    }
  }
  return { ok: false, error: "Fetch failed" };
}

/** Serialize requests (OpenAlex / Semantic Scholar shared anonymous limits). */
function createRequestQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function withQueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export const withOpenAlexQueue = createRequestQueue();
export const withSemanticScholarQueue = createRequestQueue();
