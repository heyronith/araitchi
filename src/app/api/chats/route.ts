import { createChat, listChats } from "@/lib/server/chats";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ chats: listChats() });
}

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let title = "New chat";
  try {
    const body = (await request.json()) as { title?: string };
    if (body.title?.trim()) title = body.title.trim();
  } catch {
    // empty body ok
  }

  const chat = createChat(title);
  return Response.json(chat, { status: 201 });
}
