import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const chats = sqliteTable("chats", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  role: text("role").notNull(),
  parts: text("parts").notNull(),
  modelId: text("model_id"),
  usage: text("usage"),
  createdAt: integer("created_at").notNull(),
});

export const records = sqliteTable("records", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull(),
  sourceChatId: text("source_chat_id"),
  sourceMessageId: text("source_message_id"),
  tags: text("tags").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});
