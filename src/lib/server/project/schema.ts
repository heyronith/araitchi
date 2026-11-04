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

export const gateDecisions = sqliteTable("gate_decisions", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull(),
  chatId: text("chat_id").notNull(),
  inputHash: text("input_hash").notNull(),
  layer: text("layer").notNull(),
  taskType: text("task_type").notNull(),
  stakes: text("stakes").notNull(),
  needsEvidence: integer("needs_evidence", { mode: "boolean" })
    .notNull()
    .default(false),
  confidence: real("confidence").notNull(),
  action: text("action").notNull(),
  models: text("models").notNull().default("[]"),
  estimatedCostUsd: real("estimated_cost_usd"),
  actualCostUsd: real("actual_cost_usd"),
  probeAgreement: real("probe_agreement"),
  escalated: integer("escalated", { mode: "boolean" }).notNull().default(false),
  userCorrection: text("user_correction"),
  reason: text("reason").notNull().default(""),
  latencyMs: integer("latency_ms").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const gateCorrections = sqliteTable("gate_corrections", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  taskType: text("task_type").notNull(),
  stakes: text("stakes").notNull(),
  needsEvidence: integer("needs_evidence", { mode: "boolean" })
    .notNull()
    .default(false),
  decisionId: text("decision_id"),
  createdAt: integer("created_at").notNull(),
});

/** Validation-loop experiments (preregistered predictions + deterministic verdicts). */
export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull(),
  version: integer("version").notNull().default(1),
  hypothesisIds: text("hypothesis_ids").notNull().default("[]"),
  title: text("title").notNull(),
  objective: text("objective").notNull(),
  protocol: text("protocol").notNull(),
  baselines: text("baselines").notNull().default(""),
  dataset: text("dataset").notNull().default(""),
  requiredRuns: integer("required_runs").notNull().default(1),
  seeds: text("seeds").notNull().default("[]"),
  environmentNotes: text("environment_notes").notNull().default(""),
  predictions: text("predictions").notNull().default("[]"),
  resultsPath: text("results_path").notNull(),
  resultsSchema: text("results_schema").notNull(),
  status: text("status").notNull().default("draft"),
  lockedAt: integer("locked_at"),
  lockHash: text("lock_hash"),
  lockRepoHead: text("lock_repo_head"),
  verdict: text("verdict"),
  verdictEvidence: text("verdict_evidence"),
  interpretation: text("interpretation"),
  interpretationConcern: integer("interpretation_concern", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  overrideVerdict: text("override_verdict"),
  overrideReason: text("override_reason"),
  overrideAt: integer("override_at"),
  replicationOf: text("replication_of"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Snapshots of `.research/STATE.md` (T12). */
export const stateHistory = sqliteTable("state_history", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  source: text("source").notNull().default("system"),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

/** Narrative proposals for Current status / Next steps (user accepts). */
export const stateProposals = sqliteTable("state_proposals", {
  id: text("id").primaryKey(),
  section: text("section").notNull(),
  content: text("content").notNull(),
  evidenceQuote: text("evidence_quote").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

/** Project-folder file index (T12 project map). */
export const projectFiles = sqliteTable(
  "project_files",
  {
    id: text("id").primaryKey(),
    path: text("path").notNull(),
    kind: text("kind").notNull(),
    language: text("language"),
    size: integer("size").notNull().default(0),
    mtime: integer("mtime").notNull().default(0),
    sha256: text("sha256").notNull(),
    summary: text("summary").notNull().default(""),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("project_files_path").on(t.path)],
);

export const projectFileChunks = sqliteTable(
  "project_file_chunks",
  {
    id: text("id").primaryKey(),
    fileId: text("file_id")
      .notNull()
      .references(() => projectFiles.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx").notNull().default(0),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    text: text("text").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("project_file_chunks_file_idx").on(t.fileId, t.chunkIdx)],
);

/** Unified activity feed (T12). */
export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  payload: text("payload").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

/** Agent suggestions for `.research/AGENTS.md` edits. */
export const instructionSuggestions = sqliteTable("instruction_suggestions", {
  id: text("id").primaryKey(),
  proposal: text("proposal").notNull(),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

/** Per-reply file page reads (T12 read tracker). */
export const readTracker = sqliteTable("read_tracker", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  messageId: text("message_id").notNull(),
  modelId: text("model_id"),
  path: text("path").notNull(),
  page: integer("page").notNull(),
  totalPages: integer("total_pages").notNull(),
  sha256: text("sha256").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

/** Message chunks for chat search (T12). */
export const messageChunks = sqliteTable(
  "message_chunks",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    chatId: text("chat_id").notNull(),
    chunkIdx: integer("chunk_idx").notNull().default(0),
    role: text("role").notNull(),
    modelId: text("model_id"),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("message_chunks_msg_idx").on(t.messageId, t.chunkIdx)],
);

/** Research plan milestones (T13). */
export const milestones = sqliteTable("milestones", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  goal: text("goal").notNull().default(""),
  targetDate: integer("target_date"),
  status: text("status").notNull().default("open"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Research plan tasks (T13). Table name plan_tasks to avoid SQL keyword clash. */
export const planTasks = sqliteTable("plan_tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  owner: text("owner").notNull().default("me"),
  status: text("status").notNull().default("todo"),
  dueDate: integer("due_date"),
  milestoneId: text("milestone_id"),
  hypothesisIds: text("hypothesis_ids").notNull().default("[]"),
  experimentIds: text("experiment_ids").notNull().default("[]"),
  paperIds: text("paper_ids").notNull().default("[]"),
  filePaths: text("file_paths").notNull().default("[]"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const planSuggestions = sqliteTable("plan_suggestions", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

/** Citation + claim→source map persisted per assistant message (T13). */
export const messageTrust = sqliteTable("message_trust", {
  messageId: text("message_id").primaryKey(),
  citations: text("citations").notNull().default("[]"),
  claimMap: text("claim_map").notNull().default("[]"),
  sourcedCount: integer("sourced_count").notNull().default(0),
  sentenceCount: integer("sentence_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});
