import { anonymisedCorrectionsJsonl } from "@/lib/server/gate/corrections-export";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const url = new URL(request.url);
  if (url.searchParams.get("optIn") !== "1") {
    return Response.json(
      {
        error:
          "Export requires explicit opt-in. Append ?optIn=1 to download anonymised corrections.",
      },
      { status: 403 },
    );
  }

  const body = anonymisedCorrectionsJsonl();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="gate-corrections-anonymised-${stamp}.jsonl"`,
    },
  });
}
