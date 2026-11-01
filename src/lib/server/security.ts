import "server-only";

import { getAppPort } from "./port";

/**
 * Reject cross-site writes to the local app.
 * Allows missing Origin; otherwise only http://localhost:<PORT>
 * or http://127.0.0.1:<PORT> where PORT = process.env.PORT ?? 3000.
 */
export function assertLocalOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  const port = getAppPort();
  const allowed = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);

  if (allowed.has(origin)) {
    return null;
  }

  return Response.json(
    { error: "Forbidden: non-local origin" },
    { status: 403 },
  );
}
