import { cookies } from "next/headers";

import { createS256Challenge, generateCodeVerifier } from "@/lib/server/pkce";
import { getCallbackUrl, getOpenRouterAuthUrl } from "@/lib/server/openrouter";

export const runtime = "nodejs";

const COOKIE = "araitchi_or_verifier";

export async function GET() {
  const verifier = generateCodeVerifier();
  const challenge = createS256Challenge(verifier);
  const jar = await cookies();

  jar.set(COOKIE, verifier, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
    secure: false,
  });

  const auth = new URL(getOpenRouterAuthUrl());
  auth.searchParams.set("callback_url", getCallbackUrl());
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");

  return Response.redirect(auth.toString(), 302);
}
