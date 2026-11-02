ALTER TABLE `records` ADD `created_by` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`chunk_idx` integer DEFAULT 0 NOT NULL,
	`text_hash` text NOT NULL,
	`model` text NOT NULL,
	`vector` blob NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `embeddings_owner_chunk_model` ON `embeddings` (`owner_type`,`owner_id`,`chunk_idx`,`model`);--> statement-breakpoint
CREATE TABLE `session_summaries` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`summary` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scribe_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`payload` text NOT NULL,
	`cost_usd` real,
	`created_at` integer NOT NULL,
	`undone_at` integer
);
--> statement-breakpoint
CREATE TABLE `scribe_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
