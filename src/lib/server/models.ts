import "server-only";

import { sql } from "drizzle-orm";

import { getAppDb } from "./db/client";
import { modelsCache } from "./db/schema";
import {
  mapOpenRouterModel,
  pickDefaultModelId,
  type OpenRouterModelLike,
} from "./models-utils";
import { openRouterFetch } from "./openrouter";
import { getSetting, setSetting } from "./settings";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ModelDto = {
  id: string;
  name: string;
  lab: string;
  contextLength: number | null;
  priceInPerMtok: number | null;
  priceOutPerMtok: number | null;
  modalities: string[];
  supportsTools: boolean;
  supportsStructuredOutputs: boolean;
  supportsReasoning: boolean;
  fetchedAt: number;
};

function rowToDto(row: typeof modelsCache.$inferSelect): ModelDto {
  let modalities: string[] = ["text"];
  try {
    modalities = JSON.parse(row.modalities) as string[];
  } catch {
    // keep default
  }
  return {
    id: row.id,
    name: row.name,
    lab: row.lab,
    contextLength: row.contextLength,
    priceInPerMtok: row.priceInPerMtok,
    priceOutPerMtok: row.priceOutPerMtok,
    modalities,
    supportsTools: row.supportsTools,
    supportsStructuredOutputs: row.supportsStructuredOutputs,
    supportsReasoning: row.supportsReasoning,
    fetchedAt: row.fetchedAt,
  };
}

export async function refreshModelsCache(): Promise<number> {
  const res = await openRouterFetch("/models", { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch models (${res.status})`);
  }

  const body = (await res.json()) as { data?: OpenRouterModelLike[] };
  const list = body.data ?? [];
  const now = Date.now();
  const db = getAppDb();

  db.delete(modelsCache).run();

  for (const model of list) {
    if (!model?.id) continue;
    const mapped = mapOpenRouterModel(model);
    db.insert(modelsCache)
      .values({
        id: mapped.id,
        name: mapped.name,
        lab: mapped.lab,
        contextLength: mapped.contextLength,
        priceInPerMtok: mapped.priceInPerMtok,
        priceOutPerMtok: mapped.priceOutPerMtok,
        modalities: JSON.stringify(mapped.modalities),
        supportsTools: mapped.supportsTools,
        supportsStructuredOutputs: mapped.supportsStructuredOutputs,
        supportsReasoning: mapped.supportsReasoning,
        raw: JSON.stringify(mapped.raw),
        fetchedAt: now,
      })
      .run();
  }

  setSetting("models_cache_fetched_at", now);

  const currentDefault = getSetting<string | null>("default_model_id", null);
  if (!currentDefault) {
    const picked = pickDefaultModelId(
      list.map((m) => {
        const mapped = mapOpenRouterModel(m);
        return {
          id: mapped.id,
          name: mapped.name,
          lab: mapped.lab,
          priceInPerMtok: mapped.priceInPerMtok,
          supportsTools: mapped.supportsTools,
        };
      }),
    );
    if (picked) {
      setSetting("default_model_id", picked);
    }
  }

  return list.length;
}

export async function ensureModelsCache(force = false): Promise<void> {
  const fetchedAt = getSetting<number | null>("models_cache_fetched_at", null);
  const stale = force || !fetchedAt || Date.now() - fetchedAt > CACHE_TTL_MS;

  const count = getAppDb()
    .select({ c: sql<number>`count(*)` })
    .from(modelsCache)
    .get()?.c;

  if (stale || !count) {
    await refreshModelsCache();
  }
}

export type ListModelsOptions = {
  query?: string;
  lab?: string;
  capability?: string;
};

export async function listModels(
  options: ListModelsOptions = {},
): Promise<ModelDto[]> {
  await ensureModelsCache(false);

  const db = getAppDb();
  let rows = db
    .select()
    .from(modelsCache)
    .orderBy(modelsCache.lab, modelsCache.name)
    .all();

  if (options.lab) {
    rows = rows.filter((r) => r.lab === options.lab);
  }

  if (options.capability === "tools") {
    rows = rows.filter((r) => r.supportsTools);
  } else if (options.capability === "vision") {
    rows = rows.filter((r) => {
      try {
        const mods = JSON.parse(r.modalities) as string[];
        return mods.includes("image") || mods.includes("file");
      } catch {
        return false;
      }
    });
  } else if (options.capability === "reasoning") {
    rows = rows.filter((r) => r.supportsReasoning);
  }

  if (options.query?.trim()) {
    const q = options.query.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.lab.toLowerCase().includes(q),
    );
  }

  return rows.map(rowToDto);
}

export function getFavouriteModelIds(): string[] {
  return getSetting<string[]>("favourite_model_ids", []);
}

export function setFavouriteModelIds(ids: string[]): void {
  setSetting("favourite_model_ids", ids);
}

export function getDefaultModelId(): string | null {
  return getSetting<string | null>("default_model_id", null);
}

export function setDefaultModelId(id: string): void {
  setSetting("default_model_id", id);
}
