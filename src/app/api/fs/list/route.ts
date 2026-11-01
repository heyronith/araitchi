import {
  breadcrumbsFor,
  getFsRoot,
  listSubdirectories,
} from "@/lib/server/fs-browser";
import { detectRepoPath } from "@/lib/server/project/detect-repo";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const pathParam = url.searchParams.get("path") ?? getFsRoot();

  try {
    const resolved =
      pathParam === "" || pathParam === "." ? getFsRoot() : pathParam;
    const entries = listSubdirectories(resolved);
    const crumbs = breadcrumbsFor(resolved);
    const repoPath = detectRepoPath(resolved);
    return Response.json({
      path: resolved,
      root: getFsRoot(),
      entries,
      breadcrumbs: crumbs,
      repoDetected: Boolean(repoPath),
      repoPath,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list directory",
      },
      { status: 400 },
    );
  }
}
