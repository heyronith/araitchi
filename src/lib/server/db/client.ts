import "server-only";

import path from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import { getAppDataDir } from "../paths";
import { migrateChatsFromAppDbIfNeeded } from "../project/migrate-from-app";
import { bootstrapDefaultProject } from "../project/scratch";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

type AppDb = BetterSQLite3Database<typeof schema>;

let dbSingleton: AppDb | null = null;
let sqliteSingleton: Database.Database | null = null;
let openedForDir: string | null = null;
let bootstrapped = false;

function dropLegacyChatTables(sqlite: Database.Database): void {
  sqlite.exec(`DROP TABLE IF EXISTS messages;`);
  sqlite.exec(`DROP TABLE IF EXISTS chats;`);
}

function bootstrapProjects(sqlite: Database.Database): void {
  if (bootstrapped) return;
  bootstrapped = true;
  migrateChatsFromAppDbIfNeeded();
  dropLegacyChatTables(sqlite);
  bootstrapDefaultProject();
}

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
    bootstrapped = false;
  }

  dbSingleton = openDb(dataDir);
  if (sqliteSingleton) {
    bootstrapProjects(sqliteSingleton);
  }
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
  bootstrapped = false;
}
