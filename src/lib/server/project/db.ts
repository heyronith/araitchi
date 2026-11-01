import "server-only";

import path from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { researchDir } from "./init";
import * as schema from "./schema";

export type NotebookDb = BetterSQLite3Database<typeof schema>;

const notebooks = new Map<
  string,
  { db: NotebookDb; sqlite: Database.Database }
>();

const FTS_SETUP = `
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
  title,
  body,
  content='records',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
  INSERT INTO records_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
`;

function ensureFts(sqlite: Database.Database): void {
  sqlite.exec(FTS_SETUP);
}

function openNotebook(projectPath: string): {
  db: NotebookDb;
  sqlite: Database.Database;
} {
  const root = path.resolve(projectPath);
  const existing = notebooks.get(root);
  if (existing) return existing;

  const dbPath = path.join(researchDir(root), "notebook.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  const migrationsFolder = path.join(process.cwd(), "drizzle", "project");
  migrate(db, { migrationsFolder });
  ensureFts(sqlite);

  const entry = { db, sqlite };
  notebooks.set(root, entry);
  return entry;
}

export function getNotebookDb(projectPath: string): NotebookDb {
  return openNotebook(projectPath).db;
}

export function getNotebookSqlite(projectPath: string): Database.Database {
  return openNotebook(projectPath).sqlite;
}

export function closeNotebookDb(projectPath: string): void {
  const root = path.resolve(projectPath);
  const entry = notebooks.get(root);
  if (!entry) return;
  entry.sqlite.close();
  notebooks.delete(root);
}

export function closeAllNotebookDbs(): void {
  for (const [key, entry] of notebooks) {
    entry.sqlite.close();
    notebooks.delete(key);
  }
}
