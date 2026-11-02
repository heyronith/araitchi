CREATE TABLE `gate_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`layer` text NOT NULL,
	`task_type` text NOT NULL,
	`stakes` text NOT NULL,
	`needs_evidence` integer DEFAULT false NOT NULL,
	`confidence` real NOT NULL,
	`action` text NOT NULL,
	`models` text DEFAULT '[]' NOT NULL,
	`estimated_cost_usd` real,
	`actual_cost_usd` real,
	`probe_agreement` real,
	`escalated` integer DEFAULT false NOT NULL,
	`user_correction` text,
	`reason` text DEFAULT '' NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gate_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`task_type` text NOT NULL,
	`stakes` text NOT NULL,
	`needs_evidence` integer DEFAULT false NOT NULL,
	`decision_id` text,
	`created_at` integer NOT NULL
);
