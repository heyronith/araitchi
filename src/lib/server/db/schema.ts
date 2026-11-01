import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const secrets = sqliteTable("secrets", {
  name: text("name").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const modelsCache = sqliteTable("models_cache", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  lab: text("lab").notNull(),
  contextLength: integer("context_length"),
  priceInPerMtok: real("price_in_per_mtok"),
  priceOutPerMtok: real("price_out_per_mtok"),
  modalities: text("modalities").notNull(),
  supportsTools: integer("supports_tools", { mode: "boolean" })
    .notNull()
    .default(false),
  supportsStructuredOutputs: integer("supports_structured_outputs", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  supportsReasoning: integer("supports_reasoning", { mode: "boolean" })
    .notNull()
    .default(false),
  raw: text("raw").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  lastOpenedAt: integer("last_opened_at").notNull(),
});
