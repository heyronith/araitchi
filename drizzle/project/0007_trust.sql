CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`target_date` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT 'me' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`due_date` integer,
	`milestone_id` text,
	`hypothesis_ids` text DEFAULT '[]' NOT NULL,
	`experiment_ids` text DEFAULT '[]' NOT NULL,
	`paper_ids` text DEFAULT '[]' NOT NULL,
	`file_paths` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `plan_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message_trust` (
	`message_id` text PRIMARY KEY NOT NULL,
	`citations` text DEFAULT '[]' NOT NULL,
	`claim_map` text DEFAULT '[]' NOT NULL,
	`sourced_count` integer DEFAULT 0 NOT NULL,
	`sentence_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
