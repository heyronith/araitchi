import "server-only";

import { eq } from "drizzle-orm";

import { getAppDb } from "./db/client";
import { settings } from "./db/schema";

export function getSetting<T>(key: string, defaultValue: T): T {
  const row = getAppDb()
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();

  if (!row) {
    return defaultValue;
  }

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export function setSetting(key: string, value: unknown): void {
  const now = Date.now();
  const serialized = JSON.stringify(value);

  getAppDb()
    .insert(settings)
    .values({ key, value: serialized, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: serialized, updatedAt: now },
    })
    .run();
}

export function listSettings(): Record<string, unknown> {
  const rows = getAppDb().select().from(settings).all();
  const result: Record<string, unknown> = {};

  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = null;
    }
  }

  return result;
}
