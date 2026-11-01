import "server-only";

/**
 * Reject cross-site writes to the local app.
 * Allows missing Origin (same-origin / non-browser) and localhost/127.0.0.1.
 */
export function assertLocalOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  try {
    const url = new URL(origin);
    const isLocalHost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const isHttp = url.protocol === "http:";

    if (isLocalHost && isHttp) {
      return null;
    }
  } catch {
    // fall through to reject
  }

  return Response.json(
    { error: "Forbidden: non-local origin" },
    { status: 403 },
  );
}
