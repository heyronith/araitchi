import "server-only";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { getSecret } from "./secrets";
import { getAppPort, getLocalAppOrigin } from "./port";

export function getOpenRouterBaseUrl(): string {
  return (
    process.env.ARAITCHI_OPENROUTER_BASE_URL?.trim() ||
    "https://openrouter.ai/api/v1"
  );
}

export function getOpenRouterAuthUrl(): string {
  // Real OAuth lives on openrouter.ai; mocks use the API base host.
  const base = getOpenRouterBaseUrl();
  if (base.includes("openrouter.ai")) {
    return "https://openrouter.ai/auth";
  }
  return `${base.replace(/\/api\/v1\/?$/, "")}/auth`;
}

export function openRouterAttributionHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": getLocalAppOrigin(),
    "X-Title": "Araitchi",
  };
}

export async function openRouterFetch(
  path: string,
  init: RequestInit = {},
  apiKey?: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("HTTP-Referer", getLocalAppOrigin());
  headers.set("X-Title", "Araitchi");
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = path.startsWith("http")
    ? path
    : `${getOpenRouterBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;

  return fetch(url, { ...init, headers });
}

export type OpenRouterKeyInfo = {
  label: string | null;
  usage: number | null;
  limit: number | null;
  limitRemaining: number | null;
  isFreeTier: boolean | null;
};

export async function fetchOpenRouterKeyInfo(
  apiKey: string,
): Promise<
  { ok: true; info: OpenRouterKeyInfo } | { ok: false; status: number }
> {
  const res = await openRouterFetch("/key", { method: "GET" }, apiKey);
  if (!res.ok) {
    return { ok: false, status: res.status };
  }

  const body = (await res.json()) as {
    data?: {
      label?: string;
      usage?: number;
      limit?: number | null;
      limit_remaining?: number | null;
      is_free_tier?: boolean;
    };
  };

  const data = body.data ?? {};
  return {
    ok: true,
    info: {
      label: data.label ?? null,
      usage: typeof data.usage === "number" ? data.usage : null,
      limit: typeof data.limit === "number" ? data.limit : null,
      limitRemaining:
        typeof data.limit_remaining === "number" ? data.limit_remaining : null,
      isFreeTier:
        typeof data.is_free_tier === "boolean" ? data.is_free_tier : null,
    },
  };
}

export function createOpenRouterClient(apiKey: string) {
  return createOpenRouter({
    apiKey,
    baseURL: getOpenRouterBaseUrl(),
    compatibility: "strict",
    headers: openRouterAttributionHeaders(),
  });
}

export async function requireOpenRouterApiKey(): Promise<string | null> {
  // Explicit env wins (CLI / bench / live checks). A stale UI secret — e.g. the
  // Playwright fake `sk-or-v1-fake-e2e-key` left in the app data dir — must not
  // shadow OPENROUTER_API_KEY when the owner exports a real key.
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const envPath = join(process.cwd(), ".env.local");
    if (existsSync(envPath)) {
      const m = readFileSync(envPath, "utf8").match(
        /^OPENROUTER_API_KEY=(.+)$/m,
      );
      if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // ignore
  }
  const stored = await getSecret("openrouter_api_key");
  if (stored?.trim()) return stored.trim();
  return null;
}

export function getCallbackUrl(): string {
  return `http://localhost:${getAppPort()}/api/openrouter/callback`;
}
