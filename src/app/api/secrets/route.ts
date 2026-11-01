import { z } from "zod";

import {
  SECRET_NAMES,
  deleteSecret,
  hasSecret,
  setSecret,
  type SecretName,
} from "@/lib/server/secrets";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

const putSchema = z.object({
  name: z.enum(SECRET_NAMES),
  value: z.string().min(1).max(4096),
});

export async function GET() {
  const result = SECRET_NAMES.map((name) => ({
    name,
    set: hasSecret(name),
  }));
  return Response.json(result);
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

  try {
    setSecret(parsed.data.name, parsed.data.value);
  } catch {
    return Response.json({ error: "Failed to store secret" }, { status: 500 });
  }

  return Response.json({ name: parsed.data.name, set: true });
}

export async function DELETE(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) {
    return blocked;
  }

  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");

  if (!name || !(SECRET_NAMES as readonly string[]).includes(name)) {
    return Response.json(
      { error: "Invalid or missing secret name" },
      { status: 400 },
    );
  }

  try {
    const removed = deleteSecret(name as SecretName);
    return Response.json({ name, set: false, removed });
  } catch {
    return Response.json({ error: "Failed to delete secret" }, { status: 500 });
  }
}
