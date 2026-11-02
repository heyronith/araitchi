import {
  blob,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

export const projectSettings = sqliteTable("project_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
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
  /** Who created the record: user action or automatic scribe. */
  createdBy: text("created_by").notNull().default("user"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});

export const embeddings = sqliteTable(
  "embeddings",
  {
    id: text("id").primaryKey(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    chunkIdx: integer("chunk_idx").notNull().default(0),
    textHash: text("text_hash").notNull(),
    model: text("model").notNull(),
    /** float32 little-endian binary */
    vector: blob("vector", { mode: "buffer" }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("embeddings_owner_chunk_model").on(
      t.ownerType,
      t.ownerId,
      t.chunkIdx,
      t.model,
    ),
  ],
);

export const sessionSummaries = sqliteTable("session_summaries", {
  chatId: text("chat_id").primaryKey(),
  summary: text("summary").notNull(),
  messageCount: integer("message_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const scribeBatches = sqliteTable("scribe_batches", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  messageId: text("message_id").notNull(),
  /** JSON snapshot of creates/updates for undo */
  payload: text("payload").notNull(),
  costUsd: real("cost_usd"),
  createdAt: integer("created_at").notNull(),
  undoneAt: integer("undone_at"),
});

export const scribeSuggestions = sqliteTable("scribe_suggestions", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  action: text("action").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const toolCache = sqliteTable(
  "tool_cache",
  {
    tool: text("tool").notNull(),
    argsHash: text("args_hash").notNull(),
    result: text("result").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("tool_cache_tool_args_hash").on(t.tool, t.argsHash)],
);

export const toolCalls = sqliteTable("tool_calls", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  messageId: text("message_id"),
  modelId: text("model_id"),
  tool: text("tool").notNull(),
  args: text("args").notNull(),
  status: text("status").notNull(),
  cached: integer("cached", { mode: "boolean" }).notNull().default(false),
  durationMs: integer("duration_ms").notNull().default(0),
  costUsd: real("cost_usd"),
  sources: text("sources"),
  createdAt: integer("created_at").notNull(),
});
