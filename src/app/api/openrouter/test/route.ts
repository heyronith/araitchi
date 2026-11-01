import { assertLocalOrigin } from "@/lib/server/security";
import { fetchOpenRouterKeyInfo } from "@/lib/server/openrouter";
import { getSecret } from "@/lib/server/secrets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const key = getSecret("openrouter_api_key");
  if (!key) {
    return Response.json({ ok: false, error: "Key not set" }, { status: 400 });
  }

  const result = await fetchOpenRouterKeyInfo(key);
  if (!result.ok) {
    return Response.json(
      { ok: false, error: "Invalid key", status: result.status },
      { status: 200 },
    );
  }

  return Response.json({ ok: true, ...result.info });
}
