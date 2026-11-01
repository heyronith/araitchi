CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`parent_id` text,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`model_id` text,
	`usage` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `models_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lab` text NOT NULL,
	`context_length` integer,
	`price_in_per_mtok` real,
	`price_out_per_mtok` real,
	`modalities` text NOT NULL,
	`supports_tools` integer DEFAULT false NOT NULL,
	`supports_structured_outputs` integer DEFAULT false NOT NULL,
	`supports_reasoning` integer DEFAULT false NOT NULL,
	`raw` text NOT NULL,
	`fetched_at` integer NOT NULL
);
