import { assertLocalOrigin } from "@/lib/server/security";
import {
  ensureModelsCache,
  getDefaultModelId,
  getFavouriteModelIds,
  listModels,
  refreshModelsCache,
  setDefaultModelId,
  setFavouriteModelIds,
} from "@/lib/server/models";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query") ?? undefined;
  const lab = searchParams.get("lab") ?? undefined;
  const capability = searchParams.get("capability") ?? undefined;
  const refresh = searchParams.get("refresh") === "1";

  if (refresh) {
    await refreshModelsCache();
  } else {
    await ensureModelsCache(false);
  }

  const models = await listModels({ query, lab, capability });
  return Response.json({
    models,
    favourites: getFavouriteModelIds(),
    defaultModelId: getDefaultModelId(),
  });
}

const putSchema = z.object({
  favourites: z.array(z.string()).optional(),
  defaultModelId: z.string().nullable().optional(),
});

export async function PUT(request: Request) {
  const blocked = assertLocalOrigin(request);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  if (parsed.data.favourites) {
    setFavouriteModelIds(parsed.data.favourites);
  }
  if (parsed.data.defaultModelId !== undefined) {
    if (parsed.data.defaultModelId) {
      setDefaultModelId(parsed.data.defaultModelId);
    }
  }

  return Response.json({
    favourites: getFavouriteModelIds(),
    defaultModelId: getDefaultModelId(),
  });
}
