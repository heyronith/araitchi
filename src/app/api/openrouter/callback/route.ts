import { cookies } from "next/headers";

import { getAppPort } from "@/lib/server/port";
import { openRouterFetch } from "@/lib/server/openrouter";
import { setSecret } from "@/lib/server/secrets";

export const runtime = "nodejs";

const COOKIE = "araitchi_or_verifier";

function redirectHome(params: Record<string, string>) {
  const url = new URL(`http://localhost:${getAppPort()}/`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return Response.redirect(url.toString(), 302);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const jar = await cookies();
  const verifier = jar.get(COOKIE)?.value;

  jar.delete(COOKIE);

  if (!code) {
    return redirectHome({ connect_error: "missing_code" });
  }
  if (!verifier) {
    return redirectHome({ connect_error: "missing_verifier" });
  }

  try {
    const res = await openRouterFetch("/auth/keys", {
      method: "POST",
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: "S256",
      }),
    });

    if (!res.ok) {
      return redirectHome({ connect_error: `exchange_${res.status}` });
    }

    const body = (await res.json()) as { key?: string };
    if (!body.key || typeof body.key !== "string") {
      return redirectHome({ connect_error: "no_key" });
    }

    setSecret("openrouter_api_key", body.key);
    return redirectHome({ connected: "openrouter" });
  } catch {
    return redirectHome({ connect_error: "exchange_failed" });
  }
}
