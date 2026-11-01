import "server-only";

import path from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import { getAppDataDir } from "../paths";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

type AppDb = BetterSQLite3Database<typeof schema>;

let dbSingleton: AppDb | null = null;
let sqliteSingleton: Database.Database | null = null;
let openedForDir: string | null = null;

function openDb(dataDir: string): AppDb {
  const dbPath = path.join(dataDir, "app.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  runMigrations(db);

  sqliteSingleton = sqlite;
  openedForDir = dataDir;
  return db;
}

/** Singleton app database at `<dataDir>/app.db` (WAL). Runs migrations on open. */
export function getAppDb(): AppDb {
  const dataDir = getAppDataDir();
  if (dbSingleton && openedForDir === dataDir) {
    return dbSingleton;
  }

  if (sqliteSingleton) {
    sqliteSingleton.close();
    sqliteSingleton = null;
    dbSingleton = null;
  }

  dbSingleton = openDb(dataDir);
  return dbSingleton;
}

/** Close and clear the singleton — used by tests. */
export function closeAppDb(): void {
  if (sqliteSingleton) {
    sqliteSingleton.close();
  }
  sqliteSingleton = null;
  dbSingleton = null;
  openedForDir = null;
}
