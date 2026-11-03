import path from "node:path";

import { z } from "zod";

import {
  exportResearchZip,
  importResearchZip,
} from "@/lib/server/continuity/backup";
import { tryCurrentProjectPath } from "@/lib/server/project/registry";
import { ensureScratchProject } from "@/lib/server/project/scratch";
import { assertLocalOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

function projectPath(): string {
  return tryCurrentProjectPath() ?? ensureScratchProject().path;
}

export async function GET(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();
  const result = await exportResearchZip(p);
  return Response.json({
    ok: true,
    zipPath: result.zipPath,
    fileCount: result.fileCount,
    bytes: result.bytes,
    note: "Import asks for confirmation before replacing notebook.db; a pre-import backup is taken automatically.",
  });
}

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("export") }),
  z.object({
    action: z.literal("import"),
    zipPath: z.string().min(1),
    confirmNotebookReplace: z.boolean().optional(),
  }),
]);

export async function POST(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;
  const p = projectPath();

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Invalid form" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing file" }, { status: 400 });
    }
    const confirm =
      form.get("confirmNotebookReplace") === "1" ||
      form.get("confirmNotebookReplace") === "true";
    const tmp = path.join(
      p,
      ".research",
      "backups",
      `import-${Date.now()}.zip`,
    );
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.dirname(tmp), { recursive: true });
    writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
    try {
      const result = await importResearchZip(p, tmp, {
        confirmNotebookReplace: confirm,
      });
      if (result.status === "needs_confirm") {
        return Response.json(
          {
            ok: false,
            needsConfirm: true,
            reason: result.reason,
            message: result.message,
          },
          { status: 409 },
        );
      }
      return Response.json({ ok: true, ...result });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Import failed" },
        { status: 400 },
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (parsed.data.action === "export") {
    const result = await exportResearchZip(p);
    return Response.json({
      ok: true,
      zipPath: result.zipPath,
      fileCount: result.fileCount,
      bytes: result.bytes,
    });
  }

  const resolved = path.isAbsolute(parsed.data.zipPath)
    ? parsed.data.zipPath
    : path.join(p, parsed.data.zipPath);

  try {
    const result = await importResearchZip(p, resolved, {
      confirmNotebookReplace: parsed.data.confirmNotebookReplace === true,
    });
    if (result.status === "needs_confirm") {
      return Response.json(
        {
          ok: false,
          needsConfirm: true,
          reason: result.reason,
          message: result.message,
        },
        { status: 409 },
      );
    }
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 400 },
    );
  }
}
