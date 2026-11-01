import { z } from "zod";

import { deleteChat, getChatDetail, renameChat } from "@/lib/server/chats";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

type Params = { params: Promise<{ chatId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { chatId } = await params;
  const { searchParams } = new URL(request.url);
  const leaf = searchParams.get("leaf");
  const detail = getChatDetail(chatId, leaf);
  if (!detail) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(detail);
}

const patchSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function PATCH(request: Request, { params }: Params) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const { chatId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const ok = renameChat(chatId, parsed.data.title);
  if (!ok) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ id: chatId, title: parsed.data.title });
}

export async function DELETE(request: Request, { params }: Params) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const { chatId } = await params;
  const ok = deleteChat(chatId);
  if (!ok) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
