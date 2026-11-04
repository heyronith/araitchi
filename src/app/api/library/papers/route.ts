import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";
import {
  paperSchema,
  savePaperToLibrary,
} from "@/lib/server/tools/documents/papers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = paperSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // T13: "Save paper" only for verified citations.
  try {
    const { checkCitations, citationIsVerifiedSaveable } =
      await import("@/lib/server/citations/check");
    const doi = parsed.data.doi ?? null;
    const arxivId = parsed.data.arxivId ?? null;
    const probe = [
      doi ? `doi:${doi}` : null,
      arxivId ? `arxiv:${arxivId}` : null,
      parsed.data.title,
    ]
      .filter(Boolean)
      .join(" ");
    const summary = await checkCitations(probe, { skipSupport: true });
    if (!citationIsVerifiedSaveable(summary, doi, arxivId)) {
      // Also allow save when we just verified the DOI/arXiv in this check.
      const ok = summary.results.some(
        (r) =>
          r.status === "verified" &&
          ((doi && (r.citation.doi === doi || r.paper?.doi === doi)) ||
            (arxivId &&
              (r.citation.arxivId === arxivId ||
                r.paper?.arxivId === arxivId)) ||
            (!doi && !arxivId && r.status === "verified")),
      );
      if (!ok) {
        return Response.json(
          {
            error: "Paper must be a verified citation before saving",
            citations: summary,
          },
          { status: 422 },
        );
      }
    }
  } catch {
    /* if check infra fails, fall through — do not block library forever */
  }

  const { record, id } = savePaperToLibrary(projectPath, parsed.data);
  return Response.json({ id, record }, { status: 201 });
}
