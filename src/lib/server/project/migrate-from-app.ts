import "server-only";

import Database from "better-sqlite3";
import path from "node:path";

import { getAppDataDir } from "@/lib/server/paths";
import { getSetting, setSetting } from "@/lib/server/settings";

import { getNotebookDb, getNotebookSqlite } from "./db";
import { ensureResearchStructure } from "./init";
import { getScratchProjectPath } from "./scratch";

const MIGRATION_FLAG = "migrated_chats_to_scratch_v1";

/**
 * One-time idempotent copy of app-DB chats/messages into Scratch notebook.db.
 * Safe to call after app migrations that drop chats/messages — uses raw SQL
 * against app.db if the tables still exist; otherwise no-ops.
 */
export function migrateChatsFromAppDbIfNeeded(): {
  migrated: boolean;
  chatCount: number;
  messageCount: number;
} {
  if (getSetting(MIGRATION_FLAG, false)) {
    return { migrated: false, chatCount: 0, messageCount: 0 };
  }

  const appDbPath = path.join(getAppDataDir(), "app.db");
  const sqlite = new Database(appDbPath, {
    readonly: false,
    fileMustExist: false,
  });

  try {
    const tables = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chats','messages')`,
      )
      .all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));
    if (!names.has("chats") || !names.has("messages")) {
      setSetting(MIGRATION_FLAG, true);
      return { migrated: false, chatCount: 0, messageCount: 0 };
    }

    const scratch = getScratchProjectPath();
    ensureResearchStructure(scratch, { name: "Scratch" });
    getNotebookDb(scratch);
    const nb = getNotebookSqlite(scratch);

    const chats = sqlite
      .prepare(
        `SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at ASC`,
      )
      .all() as {
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
    }[];

    const insertChat = nb.prepare(
      `INSERT OR IGNORE INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    );
    const insertMsg = nb.prepare(
      `INSERT OR IGNORE INTO messages (id, chat_id, parent_id, role, parts, model_id, usage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let messageCount = 0;
    const tx = nb.transaction(() => {
      for (const c of chats) {
        insertChat.run(c.id, c.title, c.created_at, c.updated_at);
        const msgs = sqlite
          .prepare(
            `SELECT id, chat_id, parent_id, role, parts, model_id, usage, created_at
             FROM messages WHERE chat_id = ?`,
          )
          .all(c.id) as {
          id: string;
          chat_id: string;
          parent_id: string | null;
          role: string;
          parts: string;
          model_id: string | null;
          usage: string | null;
          created_at: number;
        }[];
        for (const m of msgs) {
          insertMsg.run(
            m.id,
            m.chat_id,
            m.parent_id,
            m.role,
            m.parts,
            m.model_id,
            m.usage,
            m.created_at,
          );
          messageCount += 1;
        }
      }
    });
    tx();

    setSetting(MIGRATION_FLAG, true);
    return {
      migrated: true,
      chatCount: chats.length,
      messageCount,
    };
  } finally {
    sqlite.close();
  }
}
