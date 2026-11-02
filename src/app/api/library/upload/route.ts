import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";
import {
  MAX_LIBRARY_UPLOAD_BYTES,
  saveLibraryDocument,
} from "@/lib/server/tools/documents/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  const declared = Number(request.headers.get("content-length") ?? 0);
  // Allow a little multipart overhead on top of the file limit.
  if (declared > MAX_LIBRARY_UPLOAD_BYTES + 1024 * 1024) {
    return Response.json(
      { error: "File exceeds the 50 MB limit" },
      { status: 413 },
    );
  }

  const projectPath = tryCurrentProjectPath() ?? ensureScratchProject().path;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart body" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_LIBRARY_UPLOAD_BYTES) {
    return Response.json(
      { error: "File exceeds the 50 MB limit" },
      { status: 413 },
    );
  }

  try {
    const document = await saveLibraryDocument({
      projectPath,
      filename: file.name || "upload",
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({ document }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    const unsupported = message.startsWith("Unsupported");
    return Response.json(
      { error: unsupported ? message : "Could not read this document" },
      { status: unsupported ? 415 : 422 },
    );
  }
}
