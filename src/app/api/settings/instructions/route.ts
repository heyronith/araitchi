import { z } from "zod";

import {
  readGlobalInstructions,
  writeGlobalInstructions,
} from "@/lib/server/continuity/instructions";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  return Response.json({ global: readGlobalInstructions() });
}

const patchSchema = z.object({
  global: z.string().max(50_000),
});

export async function PATCH(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  writeGlobalInstructions(parsed.data.global);
  return Response.json({ global: readGlobalInstructions() });
}
