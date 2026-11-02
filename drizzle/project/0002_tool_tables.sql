CREATE TABLE IF NOT EXISTS `tool_cache` (
	`tool` text NOT NULL,
	`args_hash` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tool_cache_tool_args_hash` ON `tool_cache` (`tool`,`args_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text,
	`model_id` text,
	`tool` text NOT NULL,
	`args` text NOT NULL,
	`status` text NOT NULL,
	`cached` integer DEFAULT false NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`sources` text,
	`created_at` integer NOT NULL
);
