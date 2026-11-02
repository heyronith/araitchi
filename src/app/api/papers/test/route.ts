import { z } from "zod";

import { assertLocalOrigin } from "@/lib/server/security";
import { getSecret } from "@/lib/server/secrets";
import { isUsableSecret } from "@/lib/server/tools/papers/providers/util";

export const runtime = "nodejs";

const bodySchema = z.object({
  provider: z.enum(["openalex", "semantic_scholar", "core"]),
});

const TEST_QUERY = "attention is all you need";

function keyFor(
  provider: z.infer<typeof bodySchema>["provider"],
): string | null {
  const map = {
    openalex: "openalex_api_key",
    semantic_scholar: "semantic_scholar_api_key",
    core: "core_api_key",
  } as const;
  const name = map[provider];
  try {
    const v = getSecret(name);
    return isUsableSecret(v) ? v!.trim() : null;
  } catch {
    return null;
  }
}

async function probeOpenAlex(key: string | null, mailto: string) {
  const p = new URLSearchParams({ search: TEST_QUERY, per_page: "1" });
  if (mailto) p.set("mailto", mailto);
  if (key) p.set("api_key", key);
  const res = await fetch(`https://api.openalex.org/works?${p}`, {
    headers: { "User-Agent": "araitchi/0.1" },
  });
  if (!res.ok) {
    return {
      ok: false as const,
      error: `HTTP ${res.status}`,
      keyed: Boolean(key),
    };
  }
  const json = (await res.json()) as { results?: unknown[] };
  return {
    ok: true as const,
    keyed: Boolean(key),
    hits: json.results?.length ?? 0,
  };
}

async function probeSemanticScholar(key: string | null) {
  const p = new URLSearchParams({
    query: TEST_QUERY,
    limit: "1",
    fields: "title",
  });
  const headers: Record<string, string> = { "User-Agent": "araitchi/0.1" };
  if (key) headers["x-api-key"] = key;
  const res = await fetch(
    `https://api.semanticscholar.org/graph/v1/paper/search?${p}`,
    { headers },
  );
  if (!res.ok) {
    return {
      ok: false as const,
      error: `HTTP ${res.status}`,
      keyed: Boolean(key),
    };
  }
  const json = (await res.json()) as { data?: unknown[] };
  return {
    ok: true as const,
    keyed: Boolean(key),
    hits: json.data?.length ?? 0,
  };
}

async function probeCore(key: string | null) {
  if (!key) {
    return { ok: false as const, error: "Key not set", keyed: false };
  }
  const p = new URLSearchParams({ q: TEST_QUERY, limit: "1" });
  const res = await fetch(`https://api.core.ac.uk/v3/search/works?${p}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "User-Agent": "araitchi/0.1",
    },
  });
  if (!res.ok) {
    return { ok: false as const, error: `HTTP ${res.status}`, keyed: true };
  }
  const json = (await res.json()) as { results?: unknown[] };
  return {
    ok: true as const,
    keyed: true,
    hits: json.results?.length ?? 0,
  };
}

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const { provider } = parsed.data;
  const key = keyFor(provider);
  const mailto = process.env.ARAITCHI_CONTACT_EMAIL?.trim() ?? "";

  try {
    const result =
      provider === "openalex"
        ? await probeOpenAlex(key, mailto)
        : provider === "semantic_scholar"
          ? await probeSemanticScholar(key)
          : await probeCore(key);
    return Response.json({ provider, ...result });
  } catch (e) {
    return Response.json(
      {
        provider,
        ok: false,
        keyed: Boolean(key),
        error: e instanceof Error ? e.message : "Request failed",
      },
      { status: 200 },
    );
  }
}
