import { z } from "zod";

import { createSubdirectory } from "@/lib/server/fs-browser";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const bodySchema = z.object({
  parent: z.string().min(1),
  name: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const path = createSubdirectory(parsed.data.parent, parsed.data.name);
    return Response.json({ path }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create folder",
      },
      { status: 400 },
    );
  }
}
