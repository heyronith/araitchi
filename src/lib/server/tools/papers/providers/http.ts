import "server-only";

export async function fetchJson<T = unknown>(
  url: string,
  opts?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<
  { ok: true; data: T } | { ok: false; error: string; status?: number }
> {
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  opts?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, {
      headers: opts?.headers,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Fetch failed",
    };
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchText(
  url: string,
  opts?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  opts?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, {
      headers: opts?.headers,
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Fetch failed",
    };
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}
