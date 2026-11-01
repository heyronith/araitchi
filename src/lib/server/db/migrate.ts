import "server-only";

import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "./schema";

export function runMigrations(db: BetterSQLite3Database<typeof schema>): void {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  migrate(db, { migrationsFolder });
}
