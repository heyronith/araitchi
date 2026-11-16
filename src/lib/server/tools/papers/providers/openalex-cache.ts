import "server-only";

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getAppDataDir } from "@/lib/server/paths";

import { fetchJson, type FetchJsonResult } from "./http";
import { noteOpenAlexHeaders } from "./openalex-budget";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // align with papers tool TTL

type CacheEntry = {
  savedAt: number;
  data: unknown;
};

function cacheDir(): string {
  const dir = path.join(getAppDataDir(), "cache", "openalex-http");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Stable cache key: strip api_key / mailto so shared queries hit. */
export function openAlexCacheKey(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("api_key");
    u.searchParams.delete("mailto");
    // Sort params for stability
    const entries = [...u.searchParams.entries()].sort((a, b) =>
      a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
    );
    u.search = "";
    for (const [k, v] of entries) u.searchParams.append(k, v);
    return createHash("sha256").update(u.toString()).digest("hex").slice(0, 40);
  } catch {
    return createHash("sha256").update(url).digest("hex").slice(0, 40);
  }
}

function readCache(key: string): unknown | null {
  const p = path.join(cacheDir(), `${key}.json`);
  if (!existsSync(p)) return null;
  try {
    const entry = JSON.parse(readFileSync(p, "utf8")) as CacheEntry;
    if (!entry || typeof entry.savedAt !== "number") return null;
    if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown) {
  const p = path.join(cacheDir(), `${key}.json`);
  const entry: CacheEntry = { savedAt: Date.now(), data };
  writeFileSync(p, JSON.stringify(entry) + "\n");
}

/**
 * OpenAlex GET with disk cache + budget header tracking.
 * Cache hits do not consume OpenAlex credits.
 */
export async function fetchOpenAlexCached(
  url: string,
  opts?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Skip disk cache (force network). */
    bypassCache?: boolean;
    /** Do not hit the network on cache miss (budget exhausted). */
    cacheOnly?: boolean;
  },
): Promise<FetchJsonResult & { fromCache?: boolean }> {
  const key = openAlexCacheKey(url);
  if (!opts?.bypassCache) {
    const hit = readCache(key);
    if (hit != null) {
      return { ok: true, data: hit, fromCache: true };
    }
  }
  if (opts?.cacheOnly) {
    return { ok: false, error: "rate_limited", status: 429, fromCache: false };
  }

  // Use raw fetch to capture rate-limit headers (fetchJson drops them).
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
    noteOpenAlexHeaders(res.headers);
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429) {
        return { ok: false, error: "rate_limited", status: 429 };
      }
      return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    }
    try {
      const data = JSON.parse(text) as unknown;
      writeCache(key, data);
      return { ok: true, data, fromCache: false };
    } catch {
      return { ok: false, error: "invalid_json", status: res.status };
    }
  } catch {
    if (opts?.signal?.aborted) return { ok: false, error: "Aborted" };
    // Fall back to fetchJson path for retry behaviour on transient errors
    const fallback = await fetchJson(url, {
      headers: opts?.headers,
      signal: opts?.signal,
      timeoutMs,
      retries: 1,
    });
    if (fallback.ok) writeCache(key, fallback.data);
    return fallback;
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}
