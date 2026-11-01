import { z } from "zod";

import { assertLocalOrigin } from "@/lib/server/security";
import { getSetting, listSettings, setSetting } from "@/lib/server/settings";

export const runtime = "nodejs";

const putSchema = z.object({
  key: z.string().min(1).max(256),
  value: z.unknown(),
});

export async function GET() {
  return Response.json(listSettings());
}

export async function PUT(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) {
    return blocked;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { key, value } = parsed.data;
  setSetting(key, value);
  return Response.json({ key, value: getSetting(key, value) });
}
