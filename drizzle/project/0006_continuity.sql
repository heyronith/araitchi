CREATE TABLE `state_history` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT 'system' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `state_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`section` text NOT NULL,
	`content` text NOT NULL,
	`evidence_quote` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`language` text,
	`size` integer DEFAULT 0 NOT NULL,
	`mtime` integer DEFAULT 0 NOT NULL,
	`sha256` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_files_path` ON `project_files` (`path`);
--> statement-breakpoint
CREATE TABLE `project_file_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`chunk_idx` integer DEFAULT 0 NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `project_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_file_chunks_file_idx` ON `project_file_chunks` (`file_id`,`chunk_idx`);
--> statement-breakpoint
CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `instruction_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `read_tracker` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`model_id` text,
	`path` text NOT NULL,
	`page` integer NOT NULL,
	`total_pages` integer NOT NULL,
	`sha256` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`chunk_idx` integer DEFAULT 0 NOT NULL,
	`role` text NOT NULL,
	`model_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_chunks_msg_idx` ON `message_chunks` (`message_id`,`chunk_idx`);
