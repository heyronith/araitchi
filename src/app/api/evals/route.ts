import { loadEvalsPayload } from "@/lib/server/evals-results";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  return Response.json(loadEvalsPayload());
}
